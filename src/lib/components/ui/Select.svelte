<script lang="ts">
	export let label: string | undefined = undefined;
	export let value: string = '';
	export let options: Array<{ value: string; label: string }> = [];
	export let required = false;
	export let disabled = false;
	export let error: string | undefined = undefined;
	export let id: string | undefined = undefined;
	export let placeholder = 'Выберите...';

	$: selectId = id || `select-${Math.random().toString(36).substring(7)}`;
	// Если в options уже есть вариант с пустым значением — не добавляем лишний placeholder
	$: hasEmptyOption = options.some((o) => o.value === '');
</script>

<div class="mb-4">
	{#if label}
		<label for={selectId} class="block text-sm font-medium text-gray-700 mb-1">
			{label}
			{#if required}
				<span class="text-red-500">*</span>
			{/if}
		</label>
	{/if}
	<select
		id={selectId}
		{required}
		{disabled}
		bind:value
		class="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm disabled:bg-gray-100 disabled:cursor-not-allowed {error ? 'border-red-300' : ''}"
		on:change
	>
		{#if !hasEmptyOption}
			<option value="">{placeholder}</option>
		{/if}
		{#each options as option}
			<option value={option.value}>{option.label}</option>
		{/each}
	</select>
	{#if error}
		<p class="mt-1 text-sm text-red-600">{error}</p>
	{/if}
</div>

