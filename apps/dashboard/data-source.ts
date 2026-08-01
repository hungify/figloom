import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { DashboardEvent, DashboardRun } from '@figloom/contracts';

export function useRunArtifact() {
  const run = ref<DashboardRun>();
  const loading = ref(true);
  const error = ref<string>();
  const staticMode = ref(false);
  const liveMode = ref(false);
  const mockMode = ref(false);
  let events: EventSource | undefined;

  async function fetchJson(url: string): Promise<DashboardRun> {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json() as Promise<DashboardRun>;
  }

  async function refresh() {
    try {
      run.value = staticMode.value
        ? await fetchJson('./data/visual-verification.json')
        : await fetchJson('/api/run');
      error.value = undefined;
    } catch (liveError) {
      if (!staticMode.value) {
        try {
          run.value = await fetchJson('./data/visual-verification.json');
          staticMode.value = true;
          error.value = undefined;
          events?.close();
          return;
        } catch {
          // Report live error below.
        }
      }
      error.value = liveError instanceof Error ? liveError.message : String(liveError);
    } finally {
      loading.value = false;
    }
  }

  function artifactUrl(relativePath: string | undefined): string {
    if (!relativePath) return '';
    const encoded = relativePath.split('/').map(encodeURIComponent).join('/');
    return staticMode.value ? `./data/${encoded}` : `/artifacts/${encoded}`;
  }

  onMounted(async () => {
    await refresh();
    if (staticMode.value) return;
    try {
      const response = await fetch('/api/meta', { cache: 'no-store' });
      const meta = response.ok ? await response.json() as { live: boolean; mock?: boolean } : undefined;
      liveMode.value = meta?.live ?? false;
      mockMode.value = meta?.mock ?? false;
    } catch {
      liveMode.value = false;
    }
    if (!liveMode.value) return;
    events = new EventSource('/events');
    events.addEventListener('run', async (event) => {
      const update = JSON.parse((event as MessageEvent<string>).data) as DashboardEvent;
      if (update.runId === run.value?.runId) await refresh();
    });
    events.onerror = () => {
      if (run.value?.finishedAt) events?.close();
    };
  });

  onBeforeUnmount(() => events?.close());

  return { run, loading, error, staticMode, liveMode, mockMode, refresh, artifactUrl };
}
