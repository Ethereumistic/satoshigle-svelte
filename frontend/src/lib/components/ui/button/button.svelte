<script lang="ts">
	import { cn } from "$lib/utils";
	import { buttonVariants } from "./index";
	
	type Variant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
	type Size = "default" | "sm" | "lg" | "icon";

	let className = "";
	export let variant: Variant = "default";
	export let size: Size = "default";
	export { className as class };
</script>

<button
	class={cn(buttonVariants({ variant, size }), className)}
	{...$$restProps}
	on:click
	on:keydown
>
	<slot />
</button>