<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import Icon from "./Icon.svelte";
  import { fmtTime } from "$lib/format";
  import { uploadFile, type AudioHints } from "$lib/upload";

  interface Props {
    unitId: string;
    hints: AudioHints;
  }
  let { unitId, hints }: Props = $props();

  type Phase = "idle" | "recording" | "uploading" | "error";
  let phase = $state<Phase>("idle");
  let seconds = $state(0);
  let progress = $state(0);
  let message = $state("");
  let level = $state(0);

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let wakeLock: { release(): Promise<void> } | null = null;
  let audioCtx: AudioContext | null = null;
  let raf = 0;

  function pickMime(): string {
    for (const m of ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return "";
  }

  function meter(s: MediaStream) {
    audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    audioCtx.createMediaStreamSource(s).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      level = Math.min(1, peak / 64);
      raf = requestAnimationFrame(tick);
    };
    tick();
  }

  async function start() {
    message = "";
    try {
      // Echo cancellation and noise suppression are tuned for calls and eat
      // quiet voices at the back of a classroom; gain control helps them.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
    } catch {
      phase = "error";
      message = "Kein Zugriff auf das Mikrofon.";
      return;
    }
    const mime = pickMime();
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64_000 } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = finish;
    recorder.start(5000);
    seconds = 0;
    timer = setInterval(() => seconds++, 1000);
    phase = "recording";
    meter(stream);
    try {
      // A phone that locks its screen mid-lesson suspends the page and the
      // recording with it.
      wakeLock = await (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } })
        .wakeLock?.request("screen") ?? null;
    } catch { /* not supported */ }
  }

  function stop() {
    recorder?.stop();
  }

  function cleanup() {
    if (timer) clearInterval(timer);
    timer = null;
    cancelAnimationFrame(raf);
    audioCtx?.close().catch(() => {});
    audioCtx = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  }

  async function finish() {
    cleanup();
    const type = recorder?.mimeType || "audio/webm";
    const blob = new Blob(chunks, { type });
    const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
    const stamp = new Date().toLocaleString("sv-SE").replace(" ", "_").replace(/:/g, "-").slice(0, 16);
    phase = "uploading";
    progress = 0;
    try {
      await uploadFile(unitId, blob, `Aufnahme_${stamp}.${ext}`, hints, (p) => (progress = p));
      phase = "idle";
      await invalidateAll();
    } catch (err) {
      phase = "error";
      message = `Upload fehlgeschlagen: ${(err as Error).message}. Die Aufnahme wird zum Speichern angeboten.`;
      // Don't lose a lesson to a flaky connection: hand the file to the user.
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `Aufnahme_${stamp}.${ext}`;
      a.click();
    }
  }

  function beforeUnload(e: BeforeUnloadEvent) {
    if (phase === "recording" || phase === "uploading") e.preventDefault();
  }

  // An effect's teardown, not onDestroy: onDestroy also runs during SSR,
  // where none of the browser APIs in cleanup() exist.
  $effect(() => () => {
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    cleanup();
  });
</script>

<svelte:window onbeforeunload={beforeUnload} />

<div class="flex flex-wrap items-center gap-3">
  {#if phase === "recording"}
    <button type="button" class="btn-danger" onclick={stop}>
      <Icon name="player-stop" size={16} />Aufnahme beenden
    </button>
    <span class="flex items-center gap-2 font-mono text-sm tabular-nums">
      <span class="h-2.5 w-2.5 animate-pulse rounded-full bg-danger"></span>{fmtTime(seconds)}
    </span>
    <div class="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
      <div class="h-full bg-accent transition-[width] duration-75" style="width: {Math.round(level * 100)}%"></div>
    </div>
    <p class="w-full text-xs text-muted">Seite offen lassen, bis die Aufnahme hochgeladen ist.</p>
  {:else if phase === "uploading"}
    <span class="text-sm text-muted">Aufnahme wird hochgeladen … {Math.round(progress * 100)} %</span>
  {:else}
    <button type="button" class="btn" onclick={start}>
      <Icon name="microphone" size={16} />Im Browser aufnehmen
    </button>
  {/if}
  {#if message}<p class="w-full text-sm text-danger">{message}</p>{/if}
</div>
