<script>
  // Renders nothing. It exists so the review tab's ⌘5 shortcut lives outside PrDetail.svelte, which is
  // one 200KB file that conflicts on every upstream pull - the review feature touches it in one place
  // per concern and no more. `goTo` is PrDetail's goToTab, so an unfinished inline file edit still wins.
  let { goTo } = $props();

  $effect(() => {
    function onKey(event) {
      if (!event.metaKey || event.ctrlKey || event.altKey || event.key !== "5") return;
      event.preventDefault();
      goTo("review");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
</script>
