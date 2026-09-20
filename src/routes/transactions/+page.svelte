<script lang="ts">
	import { onMount } from 'svelte';
	import apiClient from '$lib/utils/api-client';
	import { toastStore } from '$lib/stores/toast';
	import { formatCurrency, formatDate } from '$lib/utils/format';
	import { getErrorMessage } from '$lib/utils/error-handler';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';

	let transactions: any[] = [];
	let accounts: any[] = [];
	let categories: any[] = [];
	let loading = false;
	let showModal = false;
	let showCreateModal = false;
	let editingTransaction: any | null = null;
	let newTransaction: any = {
		account_id: '',
		category_id: '',
		amount: 0,
		transaction_date: new Date().toISOString().split('T')[0],
		transaction_time: '',
		description: '',
		currency: 'RUB',
		exchange_rate: 1
	};

	// Фильтры
	let dateFrom = '';
	let dateTo = '';
	let accountId = '';
	let limit = 50;
	let offset = 0;
	let total = 0;

	onMount(() => {
		loadAccounts();
		loadCategories();
		loadTransactions();
	});

	async function loadAccounts() {
		try {
			const response = await apiClient.get('/accounts');
			accounts = response.data || [];
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

	async function loadTransactions() {
		loading = true;
		try {
			const params = new URLSearchParams();
			if (dateFrom) params.append('date_from', dateFrom);
			if (dateTo) params.append('date_to', dateTo);
			if (accountId) params.append('account_id', accountId);
			params.append('limit', limit.toString());
			params.append('offset', offset.toString());

			const response = await apiClient.get(`/transactions?${params.toString()}`);
			transactions = response.data.items || [];
			total = response.data.total || 0;
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
		} finally {
			loading = false;
		}
	}

	function openEditModal(transaction: any) {
		editingTransaction = { ...transaction };
		showModal = true;
	}

	async function saveTransaction() {
		if (!editingTransaction) return;

		try {
			if (editingTransaction.id) {
				await apiClient.patch(`/transactions/${editingTransaction.id}`, {
					category_id: editingTransaction.category_id || null,
					confirmed: true
				});
				toastStore.success('Транзакция обновлена');
			}
			showModal = false;
			loadTransactions();
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
		}
	}

	async function deleteTransaction(id: string) {
		if (!confirm('Удалить транзакцию?')) return;

		try {
			await apiClient.delete(`/transactions/${id}`);
			toastStore.success('Транзакция удалена');
			loadTransactions();
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
		}
	}

	function applyFilters() {
		offset = 0;
		loadTransactions();
	}

	function openCreateModal() {
		newTransaction = {
			account_id: '',
			category_id: '',
			amount: 0,
			transaction_date: new Date().toISOString().split('T')[0],
			transaction_time: '',
			description: '',
			currency: 'RUB',
			exchange_rate: 1
		};
		showNewCard = false;
		newCardName = '';
		newCardLast4 = '';
		showCreateModal = true;
	}

	// Инлайн-создание карты к выбранному счёту
	let showNewCard = false;
	let newCardName = '';
	let newCardLast4 = '';
	let creatingCard = false;

	async function createCardForAccount() {
		if (!newTransaction.account_id) {
			toastStore.error('Сначала выберите счёт');
			return;
		}
		if (!newCardLast4 || newCardLast4.length !== 4) {
			toastStore.error('Укажите последние 4 цифры номера карты');
			return;
		}
		creatingCard = true;
		try {
			const r = await apiClient.post('/cards', {
				account_id: newTransaction.account_id,
				last_four: newCardLast4,
				name: newCardName || null
			});
			toastStore.success('Карта создана');
			showNewCard = false;
			newCardName = '';
			newCardLast4 = '';
			await loadAccounts();
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
		} finally {
			creatingCard = false;
		}
	}

	async function createTransaction() {
		if (!newTransaction.account_id || !newTransaction.amount) {
			toastStore.error('Заполните обязательные поля: счет и сумма');
			return;
		}

		try {
			const payload: any = {
				account_id: newTransaction.account_id,
				amount: parseFloat(newTransaction.amount),
				transaction_date: new Date(newTransaction.transaction_date).toISOString(),
				transaction_time: newTransaction.transaction_time || '00:00:00',
				currency: newTransaction.currency || 'RUB',
				exchange_rate: parseFloat(newTransaction.exchange_rate) || 1
			};
			
			if (newTransaction.category_id) {
				payload.category_id = newTransaction.category_id;
			}
			
			if (newTransaction.description) {
				payload.description = newTransaction.description;
			}

			await apiClient.post('/transactions', payload);
			toastStore.success('Транзакция создана');
			showCreateModal = false;
			loadTransactions();
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
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
</script>

<svelte:head>
	<title>Транзакции - Budget SaaS</title>
</svelte:head>

<div class="px-4 sm:px-6 lg:px-8">
	<div class="mb-8 flex items-center justify-between">
		<h1 class="text-3xl font-bold text-gray-900">Транзакции</h1>
		<Button variant="primary" on:click={openCreateModal}>
			+ Создать транзакцию
		</Button>
	</div>

	<Card className="mb-6">
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-4">
			<Input
				label="Дата от"
				type="date"
				bind:value={dateFrom}
			/>
			<Input
				label="Дата до"
				type="date"
				bind:value={dateTo}
			/>
			<Select
				label="Счет"
				bind:value={accountId}
				options={[
					{ value: '', label: 'Все счета' },
					...accounts.map((acc) => ({ value: acc.id, label: acc.account_name }))
				]}
			/>
			<div class="flex items-end">
				<Button variant="primary" on:click={applyFilters}>Применить</Button>
			</div>
		</div>
	</Card>

	{#if loading}
		<div class="flex items-center justify-center h-64">
			<div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
		</div>
	{:else}
		<Card>
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-gray-200">
					<thead class="bg-gray-50">
						<tr>
							<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Дата</th>
							<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Сумма</th>
							<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Описание</th>
							<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Категория</th>
							<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Счет</th>
							<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Действия</th>
						</tr>
					</thead>
					<tbody class="bg-white divide-y divide-gray-200">
						{#each transactions as transaction}
							<tr class="hover:bg-gray-50">
								<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
									{formatDate(transaction.transaction_date)}
								</td>
								<td
									class="px-6 py-4 whitespace-nowrap text-sm font-medium {transaction.amount >= 0
										? 'text-green-600'
										: 'text-red-600'}"
								>
									{formatCurrency(transaction.amount, transaction.currency || 'RUB')}
								</td>
								<td class="px-6 py-4 text-sm text-gray-900">
									{transaction.description || '-'}
								</td>
								<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
									{#if transaction.predicted_category_id}
										<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
											🤖 {categories.find((c) => c.id === transaction.predicted_category_id)?.name ||
											'ML категория'}
										</span>
									{:else if transaction.category_id}
										{categories.find((c) => c.id === transaction.category_id)?.name || '-'}
									{:else}
										-
									{/if}
								</td>
								<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
									{accounts.find((a) => a.id === transaction.account_id)?.account_name || '-'}
								</td>
								<td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
									<button
										on:click={() => openEditModal(transaction)}
										class="text-primary-600 hover:text-primary-900 mr-4"
									>
										Редактировать
									</button>
									<button
										on:click={() => deleteTransaction(transaction.id)}
										class="text-red-600 hover:text-red-900"
									>
										Удалить
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div class="mt-4 flex items-center justify-between">
				<div class="text-sm text-gray-700">
					Показано {offset + 1} - {Math.min(offset + limit, total)} из {total}
				</div>
				<div class="flex space-x-2">
					<Button
						variant="secondary"
						disabled={offset === 0}
						on:click={() => {
							offset = Math.max(0, offset - limit);
							loadTransactions();
						}}
					>
						Назад
					</Button>
					<Button
						variant="secondary"
						disabled={offset + limit >= total}
						on:click={() => {
							offset += limit;
							loadTransactions();
						}}
					>
						Вперед
					</Button>
				</div>
			</div>
		</Card>
	{/if}
</div>

<Modal open={showModal} title="Редактировать транзакцию" on:close={() => (showModal = false)}>
	{#if editingTransaction}
		<div class="space-y-4">
			<div>
				<label class="block text-sm font-medium text-gray-700 mb-1">Сумма</label>
				<p class="text-lg font-semibold">
					{formatCurrency(editingTransaction.amount, editingTransaction.currency || 'RUB')}
				</p>
			</div>
			<div>
				<label class="block text-sm font-medium text-gray-700 mb-1">Описание</label>
				<p>{editingTransaction.description || '-'}</p>
			</div>
			<Select
				label="Категория"
				bind:value={editingTransaction.category_id}
				options={[
					{ value: '', label: 'Без категории' },
					...getFilteredCategories(editingTransaction.amount || 0).map((c) => ({
						value: c.id,
						label: c.name
					}))
				]}
			/>
		</div>
	{/if}
	<div slot="footer" class="flex justify-end space-x-2">
		<Button variant="secondary" on:click={() => (showModal = false)}>Отмена</Button>
		<Button variant="primary" on:click={saveTransaction}>Сохранить</Button>
	</div>
</Modal>

<Modal open={showCreateModal} title="Создать транзакцию" on:close={() => (showCreateModal = false)}>
	<div class="space-y-4">
		<Select
			label="Счет *"
			bind:value={newTransaction.account_id}
			required
			options={[
				{ value: '', label: 'Выберите счет' },
				...accounts.map((acc) => ({ value: acc.id, label: acc.account_name }))
			]}
		/>
		<button
			type="button"
			on:click={() => (showNewCard = !showNewCard)}
			class="text-primary-600 hover:text-primary-900 text-sm"
		>
			{showNewCard ? 'Скрыть добавление карты' : '+ новая карта для счёта'}
		</button>
		{#if showNewCard}
			<div class="space-y-3 rounded-md border border-gray-200 p-3">
				<p class="text-sm font-medium text-gray-700">Добавить карту к счёту</p>
				<Input
					label="Название карты"
					bind:value={newCardName}
					placeholder="VISA Classic"
				/>
				<Input
					label="Последние 4 цифры номера *"
					bind:value={newCardLast4}
					maxlength={4}
					placeholder="1234"
				/>
				<Button variant="secondary" size="sm" on:click={createCardForAccount} disabled={creatingCard}>
					{creatingCard ? 'Создание...' : 'Создать карту'}
				</Button>
			</div>
		{/if}
		<Input
			label="Сумма *"
			type="number"
			step="0.01"
			bind:value={newTransaction.amount}
			required
			on:input={(e) => {
				// Сбрасываем категорию, если она не подходит под новый тип
				const amount = parseFloat(e.currentTarget.value) || 0;
				const filteredCats = getFilteredCategories(amount);
				if (newTransaction.category_id && !filteredCats.find((c) => c.id === newTransaction.category_id)) {
					newTransaction.category_id = '';
				}
			}}
		/>
		{#key newTransaction.amount}
			<Select
				label="Категория"
				bind:value={newTransaction.category_id}
				options={[
					{ value: '', label: 'Без категории' },
					...getFilteredCategories(parseFloat(newTransaction.amount) || 0).map((c) => ({
						value: c.id,
						label: c.name
					}))
				]}
			/>
		{/key}
		<Input
			label="Дата *"
			type="date"
			bind:value={newTransaction.transaction_date}
			required
		/>
		<Input
			label="Время"
			type="time"
			bind:value={newTransaction.transaction_time}
		/>
		<Input
			label="Описание"
			type="text"
			bind:value={newTransaction.description}
		/>
		<Select
			label="Валюта"
			bind:value={newTransaction.currency}
			options={[
				{ value: 'RUB', label: 'RUB' },
				{ value: 'USD', label: 'USD' },
				{ value: 'EUR', label: 'EUR' }
			]}
		/>
		<Input
			label="Курс обмена"
			type="number"
			step="0.0001"
			bind:value={newTransaction.exchange_rate}
		/>
	</div>
	<div slot="footer" class="flex justify-end space-x-2">
		<Button variant="secondary" on:click={() => (showCreateModal = false)}>Отмена</Button>
		<Button variant="primary" on:click={createTransaction}>Создать</Button>
	</div>
</Modal>

