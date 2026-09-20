<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import apiClient from '$lib/utils/api-client';
	import { toastStore } from '$lib/stores/toast';
	import { formatCurrency, formatDate } from '$lib/utils/format';
	import { getErrorMessage } from '$lib/utils/error-handler';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Loader from '$lib/components/ui/Loader.svelte';

	let accounts: any[] = [];
	let banks: any[] = [];
	let categories: any[] = [];
	let selectedAccount = '';
	let selectedBank = '';
	let selectedFile: File | null = null;
	let uploading = false;
	let jobId: string | null = null;
	let jobStatus: string | null = null;
	let parsedTransactions: any[] = [];
	let statementAccounts: string[] = [];
	let accountMappingsMap: Record<string, string> = {};
	let checkingStatus = false;
	let pollInterval = 2000;
	let maxPollInterval = 10000;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let imports: any[] = [];
	let loadingImports = false;

	onMount(() => {
		loadAccounts();
		loadBanks();
		loadCategories();
		loadImports();
	});

	async function loadImports() {
		loadingImports = true;
		try {
			const r = await apiClient.get('/imports');
			imports = r.data || [];
		} catch (e: any) {
			toastStore.error(getErrorMessage(e));
		} finally {
			loadingImports = false;
		}
	}

	function importStatusLabel(s: string): string {
		const map: Record<string, string> = {
			pending: 'Ожидание',
			processing: 'Обработка',
			completed: 'Завершён',
			failed: 'Ошибка'
		};
		return map[s] || s;
	}

	onDestroy(() => {
		// Очищаем таймер при размонтировании компонента
		if (pollTimer) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
	});

	async function loadAccounts() {
		try {
			const response = await apiClient.get('/accounts');
			accounts = response.data || [];
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
		}
	}

	async function loadBanks() {
		try {
			const response = await apiClient.get('/banks');
			banks = response.data || [];
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
		}
	}

	async function loadCategories() {
		try {
			const response = await apiClient.get('/categories');
			categories = response.data || [];
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
		}
	}

	// Счета, отфильтрованные по выбранному банку (все, если банк не выбран)
	$: filteredAccounts = selectedBank
		? accounts.filter((a) => a.bank_id === selectedBank)
		: accounts;

	// Сброс счёта, если он не принадлежит выбранному банку
	$: if (selectedBank) {
		if (selectedAccount && !filteredAccounts.some((a) => a.id === selectedAccount)) {
			selectedAccount = '';
		}
	}
	
	// Фильтруем категории по типу (доходы/расходы) в зависимости от знака суммы
	function getFilteredCategories(amount: number) {
		if (amount >= 0) {
			// Для положительных сумм показываем только категории доходов
			return categories.filter((c) => c.type === 'income');
		} else {
			// Для отрицательных сумм показываем только категории расходов
			return categories.filter((c) => c.type === 'expense');
		}
	}

	function handleFileSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			selectedFile = target.files[0];
		}
	}

	async function uploadFile() {
		if (!selectedFile) {
			toastStore.error('Выберите файл');
			return;
		}

		uploading = true;
		try {
			const formData = new FormData();
			formData.append('file', selectedFile);
			// Счёт можно не выбирать: он распознается и подтверждается после парсинга
			if (selectedAccount) {
				formData.append('account_id', selectedAccount);
			}
			if (selectedBank) {
				const bank = banks.find((b) => b.id === selectedBank);
				formData.append('bank_type', bank ? bank.name : selectedBank);
			}

			const response = await apiClient.post('/parser/upload', formData, {
				headers: {
					'Content-Type': 'multipart/form-data'
				}
			});

			jobId = response.data.job_id;
			jobStatus = response.data.status;
			statementAccounts = [];
			accountMappingsMap = {};
			pollInterval = 2000;
			toastStore.success('Файл загружен, начинается обработка...');
			checkJobStatus();
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
		} finally {
			uploading = false;
		}
	}

	async function checkJobStatus() {
		if (!jobId) return;

		checkingStatus = true;
		try {
			const response = await apiClient.get(`/parser/result/${jobId}`);
			jobStatus = response.data.status;
			parsedTransactions = response.data.transactions || [];
			statementAccounts = response.data.statement_accounts || [];

			// Автоподбор счёта: если в выписке один счёт и он совпадает с account_last5
			// или названием счёта пользователя — подставляем его по умолчанию.
			if (jobStatus === 'completed' && statementAccounts.length > 0) {
				accountMappingsMap = {};
				for (const sa of statementAccounts) {
					const match = accounts.find(
						(a) =>
							(a.account_last5 && sa.endsWith(a.account_last5)) ||
							String(a.account_name).toLowerCase().includes(sa.toLowerCase())
					);
					if (match) accountMappingsMap[sa] = match.id;
				}
				// Если не выбран ни один счёт и есть ровно один счёт в выписке — берём его
				if (!selectedAccount && Object.keys(accountMappingsMap).length === 0 && statementAccounts.length === 1) {
					// без маппинга, просто запоминаем единственный как целевой
				}
			}

			if (jobStatus === 'processing' || jobStatus === 'pending') {
				// Экспоненциальный backoff: увеличиваем интервал до максимума
				pollInterval = Math.min(pollInterval * 1.5, maxPollInterval);
				// Проверяем снова через увеличивающийся интервал
				pollTimer = setTimeout(() => checkJobStatus(), pollInterval);
			} else if (jobStatus === 'failed') {
				toastStore.error('Ошибка обработки файла: ' + (response.data.error || 'Неизвестная ошибка'));
				pollTimer = null;
			} else if (jobStatus === 'completed') {
				// Останавливаем polling при завершении
				pollTimer = null;
				pollInterval = 2000; // Сбрасываем интервал для следующего файла
			}
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
			// При ошибке продолжаем polling с увеличенным интервалом
			if (jobStatus === 'processing' || jobStatus === 'pending') {
				pollInterval = Math.min(pollInterval * 1.5, maxPollInterval);
				pollTimer = setTimeout(() => checkJobStatus(), pollInterval);
			}
		} finally {
			checkingStatus = false;
		}
	}

	async function classifyByRules() {
		if (parsedTransactions.length === 0) {
			toastStore.warning('Нет транзакций для разметки');
			return;
		}
		let classified = 0;
		for (const tx of parsedTransactions) {
			if (tx.category_id) continue;
			const account = accounts.find((a) => a.id === selectedAccount);
			try {
				const r = await apiClient.post('/user_rules/resolve', {
					description: tx.description || '',
					amount: tx.amount || 0,
					bank: account ? account.account_name : '',
					type: tx.amount >= 0 ? 'income' : 'expense',
					statement_account: tx.statement_account || ''
				});
				if (r.data?.category_id) {
					tx.category_id = r.data.category_id;
					classified++;
				}
			} catch (e: any) {
				toastStore.error(getErrorMessage(e));
			}
		}
		toastStore.success(`Размечено по правилам: ${classified} транзакций`);
	}

	async function classifyAuto() {
		if (parsedTransactions.length === 0) {
			toastStore.warning('Нет транзакций для разметки');
			return;
		}
		try {
			await apiClient.post('/parser/classify', {
				job_id: jobId,
				transactions: parsedTransactions.filter((tx) => !tx.category_id).map((tx) => ({
					amount: tx.amount,
					description: tx.description || '',
					date: tx.date,
					currency: tx.currency || 'RUB',
					statement_account: tx.statement_account || ''
				}))
			});
		toastStore.success('Автоклассификация запущена');
	} catch (e: any) {
		toastStore.error(getErrorMessage(e));
	}
}

async function commitTransactions() {
		if (!jobId) return;

		// Собираем маппинги: счёт из выписки → системный счёт
		const accountMappings = [];
		for (const sa of statementAccounts) {
			const target = accountMappingsMap[sa];
			if (target) {
				accountMappings.push({
					statement_account_type: 'bank',
					statement_account_value: sa,
					account_id: target
				});
			}
		}

		// Если маппинги не заполнены — используем выбранный вручную счёт (единый)
		let commitAccountId = selectedAccount;
		if (!commitAccountId && Object.keys(accountMappingsMap).length === 1) {
			commitAccountId = Object.values(accountMappingsMap)[0];
		}

		try {
			const body: any = {
				transactions: parsedTransactions.map((tx) => ({
					amount: tx.amount,
					description: tx.description || '',
					date: tx.date,
					time: tx.time || null,
					currency: tx.currency || 'RUB',
					external_id: tx.external_id || null,
					category_id: tx.category_id || null
				}))
			};
			if (commitAccountId) body.account_id = commitAccountId;
			if (accountMappings.length > 0) body.account_mappings = accountMappings;

			await apiClient.post(`/parser/commit/${jobId}`, body);
			toastStore.success('Транзакции успешно добавлены');
			// Сброс состояния
			jobId = null;
			jobStatus = null;
			parsedTransactions = [];
			statementAccounts = [];
			accountMappingsMap = {};
			selectedFile = null;
			selectedAccount = '';
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
		}
	}

	function onMappingChange(statementValue: string, accountId: string) {
		if (accountId) {
			accountMappingsMap[statementValue] = accountId;
		} else {
			delete accountMappingsMap[statementValue];
		}
	}

	function selectValueOf(select: HTMLSelectElement | null): string {
		return select ? select.value : '';
	}

	function getStatusColor(status: string) {
		switch (status) {
			case 'completed':
				return 'bg-green-100 text-green-800';
			case 'processing':
			case 'pending':
				return 'bg-yellow-100 text-yellow-800';
			case 'failed':
				return 'bg-red-100 text-red-800';
			default:
				return 'bg-gray-100 text-gray-800';
		}
	}
</script>

<svelte:head>
	<title>Парсер - Budget SaaS</title>
</svelte:head>

<div class="px-4 sm:px-6 lg:px-8">
	<div class="mb-8">
		<h1 class="text-3xl font-bold text-gray-900">Парсер выписок</h1>
		<p class="mt-2 text-sm text-gray-600">Загрузите CSV или PDF файл для автоматического извлечения транзакций</p>
	</div>

	<Card className="mb-6">
		<div class="space-y-4">
			<Select
				label="Банк (необязательно)"
				bind:value={selectedBank}
				placeholder="Автоопределение по заголовкам файла"
				options={[
					{ value: '', label: 'Автоопределение по заголовкам файла' },
					...banks.map((b) => ({ value: b.id, label: b.name }))
				]}
			/>

			<Select
				label="Счет (можно не выбирать — определится при парсинге)"
				bind:value={selectedAccount}
				placeholder="Автоматически / не выбран"
				options={[
					{ value: '', label: 'Автоматически / не выбран' },
					...filteredAccounts.map((a) => ({
						value: a.id,
						label: a.account_name + (a.account_last5 ? ` (…${a.account_last5})` : '')
					}))
				]}
			/>

			<div>
				<label for="statement-file" class="block text-sm font-medium text-gray-700 mb-1">
					Файл (CSV или PDF)
				</label>
				<input
					id="statement-file"
					type="file"
					accept=".csv,.pdf"
					on:change={handleFileSelect}
					class="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
				/>
				{#if selectedFile}
					<p class="mt-2 text-sm text-gray-600">Выбран: {selectedFile.name}</p>
				{/if}
			</div>

			<Button variant="primary" on:click={uploadFile} disabled={uploading || !selectedFile}>
				{uploading ? 'Загрузка...' : 'Загрузить и обработать'}
			</Button>
		</div>
	</Card>

	{#if jobId}
		<Card>
			<div class="mb-4">
				<div class="flex items-center justify-between">
					<div>
						<h3 class="text-lg font-semibold text-gray-900">Статус обработки</h3>
						<p class="text-sm text-gray-500">Job ID: {jobId}</p>
					</div>
					{#if checkingStatus}
						<Loader size="sm" />
					{:else if jobStatus}
						<span
							class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium {getStatusColor(jobStatus)}"
						>
							{#if jobStatus === 'completed'}✓{/if}
							{#if jobStatus === 'processing' || jobStatus === 'pending'}⏳{/if}
							{#if jobStatus === 'failed'}✕{/if}
							<span class="ml-2">
								{#if jobStatus === 'completed'}Завершено{/if}
								{#if jobStatus === 'processing'}Обработка...{/if}
								{#if jobStatus === 'pending'}Ожидание...{/if}
								{#if jobStatus === 'failed'}Ошибка{/if}
							</span>
						</span>
					{/if}
				</div>
			</div>

{#if jobStatus === 'completed' && parsedTransactions.length > 0}

			{#if statementAccounts.length > 0}
				<div class="mb-4 rounded-md bg-gray-50 p-3">
					<p class="text-sm font-medium text-gray-700 mb-2">
						Счета в выписке — выберите, на какие счета импортировать операции:
					</p>
					<div class="space-y-2">
						{#each statementAccounts as sa}
							<div class="flex items-center gap-2">
								<span class="text-sm font-mono text-gray-800 w-40 truncate">{sa}</span>
								<select
									value={accountMappingsMap[sa] || ''}
									on:change={(e) => onMappingChange(sa, selectValueOf(e.currentTarget))}
									class="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
								>
									<option value="">— выберите счёт —</option>
									{#each filteredAccounts as a}
										<option value={a.id}>{a.account_name}{a.account_last5 ? ` (…${a.account_last5})` : ''}</option>
									{/each}
								</select>
							</div>
						{/each}
					</div>
				</div>
			{:else if !selectedAccount}
				<div class="mb-4 rounded-md bg-yellow-50 p-3 text-sm text-gray-700">
					Счета в выписке не распознаны. Выберите счёт вверху или импортируйте без привязки.
				</div>
			{/if}

			<div class="mb-4">
					<p class="text-sm text-gray-600 mb-2">
						Найдено транзакций: {parsedTransactions.length}
					</p>
					<div class="overflow-x-auto max-h-96 overflow-y-auto">
						<table class="min-w-full divide-y divide-gray-200">
							<thead class="bg-gray-50 sticky top-0">
								<tr>
									<th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Дата</th>
									<th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Сумма</th>
									<th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
										Описание
									</th>
									<th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
										Категория
									</th>
								</tr>
							</thead>
							<tbody class="bg-white divide-y divide-gray-200">
								{#each parsedTransactions as tx, index}
									<tr class="hover:bg-gray-50">
										<td class="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
											{formatDate(tx.date)}
										</td>
										<td
											class="px-4 py-2 whitespace-nowrap text-sm font-medium {tx.amount >= 0
												? 'text-green-600'
												: 'text-red-600'}"
										>
											{formatCurrency(tx.amount, tx.currency || 'RUB')}
										</td>
										<td class="px-4 py-2 text-sm text-gray-900">{tx.description || '-'}</td>
										<td class="px-4 py-2 text-sm text-gray-900">
											<select
												bind:value={tx.category_id}
												class="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm"
											>
												<option value="">Без категории</option>
												{#each getFilteredCategories(tx.amount || 0) as category}
													<option value={category.id}>{category.name}</option>
												{/each}
											</select>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			<Button variant="secondary" on:click={classifyByRules} disabled={jobStatus !== 'completed'}>
				Разметить по правилам
			</Button>
			<Button variant="secondary" on:click={classifyAuto} disabled={jobStatus !== 'completed'}>
				Разметить автоматически
			</Button>
			<Button variant="primary" on:click={commitTransactions} disabled={jobStatus !== 'completed'}>
				Сохранить транзакции
			</Button>
			{/if}
		</Card>
	{/if}

	<Card className="mt-6">
		<div class="flex items-center justify-between mb-4">
			<h2 class="text-lg font-medium text-gray-900">История импортов</h2>
			<Button variant="secondary" size="sm" on:click={loadImports}>Обновить</Button>
		</div>
		{#if loadingImports}
			<Loader />
		{:else if imports.length === 0}
			<p class="text-sm text-gray-500">Импортов пока нет.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-gray-200">
					<thead class="bg-gray-50">
						<tr>
							<th
								class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
							>Файл</th>
							<th
								class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
							>Формат</th>
							<th
								class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
							>Статус</th>
							<th
								class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
							>Прогресс</th>
							<th
								class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
							>Дата</th>
						</tr>
					</thead>
					<tbody class="bg-white divide-y divide-gray-200">
						{#each imports as imp (imp.id)}
							<tr class="hover:bg-gray-50">
								<td class="px-4 py-2 text-sm text-gray-900">{imp.file_name || '-'}</td>
								<td class="px-4 py-2 text-sm text-gray-700">{imp.format || 'csv'}</td>
								<td class="px-4 py-2 text-sm text-gray-700">
									<span
										class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {imp.status === 'completed'
											? 'bg-green-100 text-green-700'
											: imp.status === 'failed'
												? 'bg-red-100 text-red-700'
												: 'bg-yellow-100 text-yellow-700'}"
									>
										{importStatusLabel(imp.status)}
									</span>
								</td>
								<td class="px-4 py-2 text-sm text-gray-700">
									{imp.success_rows}/{imp.total_rows}
									{#if imp.error_rows > 0}
										<span class="text-red-600"> ({imp.error_rows} ош.)</span>
									{/if}
								</td>
								<td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">
									{formatDate(imp.created_at)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</Card>
</div>

