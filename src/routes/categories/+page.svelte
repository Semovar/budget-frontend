<script lang="ts">
	import { onMount } from 'svelte';
	import apiClient from '$lib/utils/api-client';
	import { toastStore } from '$lib/stores/toast';
	import { getErrorMessage } from '$lib/utils/error-handler';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';

	let categories: any[] = [];
	let supercategories: any[] = [];
	let loading = false;
	let showCategoryModal = false;
	let showSupercategoryModal = false;
	let editingCategory: any | null = null;
	let editingSupercategory: any | null = null;

	onMount(() => {
		loadSupercategories();
		loadCategories();
		loadRules();
	});

	async function loadSupercategories() {
		try {
			const response = await apiClient.get('/supercategories');
			supercategories = response.data || [];
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
		}
	}

	async function loadCategories() {
		loading = true;
		try {
			const response = await apiClient.get('/categories');
			categories = response.data || [];
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
		} finally {
			loading = false;
		}
	}

	function openCreateCategoryModal() {
		editingCategory = {
			name: '',
			type: 'expense',
			supercategory_id: '',
			description: ''
		};
		showCategoryModal = true;
	}

	function openEditCategoryModal(category: any) {
		editingCategory = { ...category };
		showCategoryModal = true;
	}

	async function saveCategory() {
		if (!editingCategory || !editingCategory.name) {
			toastStore.error('Введите название категории');
			return;
		}

		try {
			const data = {
				name: editingCategory.name,
				type: editingCategory.type,
				supercategory_id: editingCategory.supercategory_id || null,
				description: editingCategory.description || null
			};

			if (editingCategory.id) {
				await apiClient.put(`/categories/${editingCategory.id}`, data);
				toastStore.success('Категория обновлена');
			} else {
				await apiClient.post('/categories', data);
				toastStore.success('Категория создана');
			}
			showCategoryModal = false;
			loadCategories();
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
		}
	}

	async function deleteCategory(id: string) {
		if (!confirm('Удалить категорию?')) return;

		try {
			await apiClient.delete(`/categories/${id}`);
			toastStore.success('Категория удалена');
			loadCategories();
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
		}
	}

	function openCreateSupercategoryModal() {
		editingSupercategory = { name: '', description: '' };
		showSupercategoryModal = true;
	}

	function openEditSupercategoryModal(supercategory: any) {
		editingSupercategory = { ...supercategory };
		showSupercategoryModal = true;
	}

	async function saveSupercategory() {
		if (!editingSupercategory || !editingSupercategory.name) {
			toastStore.error('Введите название надкатегории');
			return;
		}

		try {
			const data: any = {
				name: editingSupercategory.name.trim()
			};
			
			// Добавляем description только если оно не пустое
			if (editingSupercategory.description && editingSupercategory.description.trim()) {
				data.description = editingSupercategory.description.trim();
			}

			if (editingSupercategory.id) {
				await apiClient.put(`/supercategories/${editingSupercategory.id}`, data);
				toastStore.success('Надкатегория обновлена');
			} else {
				await apiClient.post('/supercategories', data);
				toastStore.success('Надкатегория создана');
			}
			showSupercategoryModal = false;
			loadSupercategories();
		} catch (error: any) {
			console.error('Error saving supercategory:', error);
			const errorMessage = getErrorMessage(error);
			console.error('Error message:', errorMessage);
			toastStore.error(errorMessage || 'Не удалось создать надкатегорию');
		}
	}

	async function deleteSupercategory(id: string) {
		if (!confirm('Удалить надкатегорию?')) return;

		try {
			await apiClient.delete(`/supercategories/${id}`);
			toastStore.success('Надкатегория удалена');
			loadSupercategories();
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
		}
	}

	// ----- Правила разметки (UserRules) -----
	let rules: any[] = [];
	let loadingRules = false;
	let showRuleModal = false;
	let editingRule: any | null = null;

	async function loadRules() {
		loadingRules = true;
		try {
			const response = await apiClient.get('/user_rules');
			rules = response.data || [];
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
		} finally {
			loadingRules = false;
		}
	}

	function openCreateRuleModal() {
		editingRule = {
			name: '',
			priority: 0,
			category_id: '',
			type: '',
			description: '',
			bank: '',
			card: '',
			amount_min: '',
			amount_max: '',
			enabled: true
		};
		showRuleModal = true;
	}

	function openEditRuleModal(rule: any) {
		// Правило хранит conditions как объект JSON — мапим в плоские поля формы
		const c = (rule.conditions && typeof rule.conditions === 'object') ? rule.conditions : {};
		const arr = (v: any): string => (Array.isArray(v) ? v.join(', ') : v ? String(v) : '');
		editingRule = {
			id: rule.id,
			name: rule.name || '',
			priority: rule.priority ?? 0,
			category_id: rule.category_id || '',
			enabled: rule.enabled ?? true,
			description: arr(c.description),
			bank: arr(c.bank),
			card: arr(c.card),
			type: c.type || '',
			amount_min: c.amount_min != null ? String(c.amount_min) : '',
			amount_max: c.amount_max != null ? String(c.amount_max) : ''
		};
		showRuleModal = true;
	}

	function parseKeywordList(s: string): string[] {
		return s.split(',').map((x) => x.trim()).filter(Boolean);
	}

	async function saveRule() {
		if (!editingRule || !editingRule.name) {
			toastStore.error('Введите название правила');
			return;
		}
		if (!editingRule.category_id) {
			toastStore.error('Выберите целевую категорию');
			return;
		}

		const conditions: any = {};
		const desc = parseKeywordList(editingRule.description || '');
		const bank = parseKeywordList(editingRule.bank || '');
		const card = parseKeywordList(editingRule.card || '');
		if (desc.length) conditions.description = desc.length === 1 ? desc[0] : desc;
		if (bank.length) conditions.bank = bank.length === 1 ? bank[0] : bank;
		if (card.length) conditions.card = card.length === 1 ? card[0] : card;
		if (editingRule.type) conditions.type = editingRule.type;
		if (editingRule.amount_min !== '' && editingRule.amount_min != null) {
			conditions.amount_min = Number(editingRule.amount_min);
		}
		if (editingRule.amount_max !== '' && editingRule.amount_max != null) {
			conditions.amount_max = Number(editingRule.amount_max);
		}

		const data: any = {
			name: editingRule.name.trim(),
			priority: Number(editingRule.priority) || 0,
			category_id: editingRule.category_id,
			enabled: editingRule.enabled,
			conditions
		};

		try {
			if (editingRule.id) {
				await apiClient.patch(`/user_rules/${editingRule.id}`, data);
				toastStore.success('Правило обновлено');
			} else {
				await apiClient.post('/user_rules', data);
				toastStore.success('Правило создано');
			}
			showRuleModal = false;
			loadRules();
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
		}
	}

	async function deleteRule(id: string) {
		if (!confirm('Удалить правило?')) return;
		try {
			await apiClient.delete(`/user_rules/${id}`);
			toastStore.success('Правило удалено');
			loadRules();
		} catch (error: any) {
			toastStore.error(getErrorMessage(error));
		}
	}

	function conditionsSummary(c: any): string {
		if (!c || typeof c !== 'object') return '';
		const parts: string[] = [];
		const fmt = (v: any) => (Array.isArray(v) ? v.join(', ') : v);
		if (c.description) parts.push(`описание: ${fmt(c.description)}`);
		if (c.bank) parts.push(`банк: ${fmt(c.bank)}`);
		if (c.card) parts.push(`карта: ${fmt(c.card)}`);
		if (c.type) parts.push(`тип: ${c.type}`);
		if (c.amount_min != null) parts.push(`мин: ${c.amount_min}`);
		if (c.amount_max != null) parts.push(`макс: ${c.amount_max}`);
		return parts.join(' · ');
	}
</script>

<svelte:head>
	<title>Категории - Budget SaaS</title>
</svelte:head>

<div class="px-4 sm:px-6 lg:px-8">
	<div class="mb-8 flex justify-between items-center">
		<h1 class="text-3xl font-bold text-gray-900">Категории</h1>
		<div class="flex space-x-2">
			<Button variant="secondary" on:click={openCreateSupercategoryModal}>
				Добавить надкатегорию
			</Button>
			<Button variant="primary" on:click={openCreateCategoryModal}>Добавить категорию</Button>
		</div>
	</div>

	{#if loading}
		<div class="flex items-center justify-center h-64">
			<div class="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
		</div>
	{:else}
		<div class="space-y-6">
			<!-- Правила разметки -->
			<Card title="Правила разметки">
				<div class="flex justify-end mb-3">
					<Button variant="primary" size="sm" on:click={openCreateRuleModal}>
						Добавить правило
					</Button>
				</div>
				{#if loadingRules}
					<p class="text-sm text-gray-500">Загрузка...</p>
				{:else if rules.length === 0}
					<p class="text-sm text-gray-500">Правил разметки пока нет.</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="min-w-full divide-y divide-gray-200">
							<thead class="bg-gray-50">
								<tr>
									<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Название</th>
									<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Условие</th>
									<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Категория</th>
									<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Приоритет</th>
									<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Вкл</th>
									<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Действия</th>
								</tr>
							</thead>
							<tbody class="bg-white divide-y divide-gray-200">
								{#each rules as rule}
									<tr class="hover:bg-gray-50">
										<td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
											{rule.name}
										</td>
										<td class="px-6 py-4 text-sm text-gray-500">
											{conditionsSummary(rule.conditions) || '—'}
										</td>
										<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
											{categories.find((c) => c.id === rule.category_id)?.name || '—'}
										</td>
										<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{rule.priority}</td>
										<td class="px-6 py-4 whitespace-nowrap text-sm">
											<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {rule.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'}">
												{rule.enabled ? 'да' : 'нет'}
											</span>
										</td>
										<td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
											<button on:click={() => openEditRuleModal(rule)} class="text-primary-600 hover:text-primary-900 mr-4">
												Редактировать
											</button>
											<button on:click={() => deleteRule(rule.id)} class="text-red-600 hover:text-red-900">
												Удалить
											</button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</Card>

			<!-- Надкатегории -->
			<Card title="Надкатегории">
				<div class="overflow-x-auto">
					<table class="min-w-full divide-y divide-gray-200">
						<thead class="bg-gray-50">
							<tr>
								<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
									Название
								</th>
								<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
									Описание
								</th>
								<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
									Действия
								</th>
							</tr>
						</thead>
						<tbody class="bg-white divide-y divide-gray-200">
							{#each supercategories as supercategory}
								<tr class="hover:bg-gray-50">
									<td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
										{supercategory.name}
									</td>
									<td class="px-6 py-4 text-sm text-gray-500">
										{supercategory.description || '-'}
									</td>
									<td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
										<button
											on:click={() => openEditSupercategoryModal(supercategory)}
											class="text-primary-600 hover:text-primary-900 mr-4"
										>
											Редактировать
										</button>
										<button
											on:click={() => deleteSupercategory(supercategory.id)}
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
			</Card>

			<!-- Категории -->
			<Card title="Категории">
				<div class="overflow-x-auto">
					<table class="min-w-full divide-y divide-gray-200">
						<thead class="bg-gray-50">
							<tr>
								<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
									Название
								</th>
								<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Тип</th>
								<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
									Надкатегория
								</th>
								<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
									Действия
								</th>
							</tr>
						</thead>
						<tbody class="bg-white divide-y divide-gray-200">
							{#each categories as category}
								<tr class="hover:bg-gray-50">
									<td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
										{category.name}
									</td>
									<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
										<span
											class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {category.type === 'income'
												? 'bg-green-100 text-green-800'
												: 'bg-red-100 text-red-800'}"
										>
											{category.type === 'income' ? 'Доход' : 'Расход'}
										</span>
									</td>
									<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
										{supercategories.find((s) => s.id === category.supercategory_id)?.name || '-'}
									</td>
									<td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
										<button
											on:click={() => openEditCategoryModal(category)}
											class="text-primary-600 hover:text-primary-900 mr-4"
										>
											Редактировать
										</button>
										<button
											on:click={() => deleteCategory(category.id)}
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
			</Card>
		</div>
	{/if}
</div>

<!-- Модальное окно категории -->
<Modal
	open={showCategoryModal}
	title={editingCategory?.id ? 'Редактировать категорию' : 'Создать категорию'}
	on:close={() => (showCategoryModal = false)}
>
	{#if editingCategory}
		<div class="space-y-4">
			<Input label="Название" bind:value={editingCategory.name} required />
			<Select
				label="Тип"
				bind:value={editingCategory.type}
				required
				options={[
					{ value: 'income', label: 'Доход' },
					{ value: 'expense', label: 'Расход' }
				]}
			/>
			<Select
				label="Надкатегория"
				bind:value={editingCategory.supercategory_id}
				options={[
					{ value: '', label: 'Без надкатегории' },
					...supercategories.map((s) => ({ value: s.id, label: s.name }))
				]}
			/>
			<Input label="Описание" bind:value={editingCategory.description} />
		</div>
	{/if}
	<div slot="footer" class="flex justify-end space-x-2">
		<Button variant="secondary" on:click={() => (showCategoryModal = false)}>Отмена</Button>
		<Button variant="primary" on:click={saveCategory}>Сохранить</Button>
	</div>
</Modal>

<!-- Модальное окно надкатегории -->
<Modal
	open={showSupercategoryModal}
	title={editingSupercategory?.id ? 'Редактировать надкатегорию' : 'Создать надкатегорию'}
	on:close={() => (showSupercategoryModal = false)}
>
	{#if editingSupercategory}
		<div class="space-y-4">
			<Input label="Название" bind:value={editingSupercategory.name} required />
			<Input label="Описание" bind:value={editingSupercategory.description} />
		</div>
	{/if}
	<div slot="footer" class="flex justify-end space-x-2">
		<Button variant="secondary" on:click={() => (showSupercategoryModal = false)}>Отмена</Button>
		<Button variant="primary" on:click={saveSupercategory}>Сохранить</Button>
	</div>
</Modal>

<!-- Модальное окно правила разметки -->
<Modal
	open={showRuleModal}
	title={editingRule?.id ? 'Редактировать правило' : 'Создать правило'}
	on:close={() => (showRuleModal = false)}
>
	{#if editingRule}
		<div class="space-y-4">
			<Input label="Название" bind:value={editingRule.name} required />
			<div class="grid grid-cols-2 gap-4">
				<Input label="Приоритет" type="number" bind:value={editingRule.priority} />
				<Select
					label="Тип"
					bind:value={editingRule.type}
					options={[
						{ value: '', label: 'Любой' },
						{ value: 'income', label: 'Доход' },
						{ value: 'expense', label: 'Расход' }
					]}
				/>
			</div>
			<Select
				label="Целевая категория (обязательно)"
				bind:value={editingRule.category_id}
				placeholder="Выберите категорию"
				options={categories.map((c) => ({ value: c.id, label: `${c.name} (${c.type === 'income' ? 'Доход' : 'Расход'})` }))}
			/>
			<Input
				label="Слова в описании (через запятую)"
				placeholder="ПЯТЕРОЧКА, Вкусвилл"
				bind:value={editingRule.description}
			/>
			<div class="grid grid-cols-2 gap-4">
				<Input label="Банк (ключевое слово)" placeholder="Альфа" bind:value={editingRule.bank} />
				<Input label="Карта (номер или имя)" placeholder="…1234" bind:value={editingRule.card} />
			</div>
			<div class="grid grid-cols-2 gap-4">
				<Input label="Сумма от" type="number" bind:value={editingRule.amount_min} />
				<Input label="Сумма до" type="number" bind:value={editingRule.amount_max} />
			</div>
			<label class="flex items-center gap-2 text-sm text-gray-700">
				<input type="checkbox" bind:checked={editingRule.enabled} class="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
				Правило включено
			</label>
		</div>
	{/if}
	<div slot="footer" class="flex justify-end space-x-2">
		<Button variant="secondary" on:click={() => (showRuleModal = false)}>Отмена</Button>
		<Button variant="primary" on:click={saveRule}>Сохранить</Button>
	</div>
</Modal>

