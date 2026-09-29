<script lang="ts">
  interface Props {
    title?: string;
    subject?: string;
    held_on?: string | null;
    notes?: string;
    subjects?: string[];
  }
  let { title = "", subject = "", held_on = null, notes = "", subjects = [] }: Props = $props();

  const today = new Date().toISOString().slice(0, 10);
</script>

<div class="grid gap-4 sm:grid-cols-[1fr_12rem]">
  <label class="block">
    <span class="label">Titel</span>
    <input class="input" name="title" value={title} required maxlength="200" placeholder="z. B. Photosynthese – Lichtreaktion" />
  </label>
  <label class="block">
    <span class="label">Datum</span>
    <input class="input" type="date" name="held_on" value={held_on ?? today} />
  </label>
</div>
<label class="block">
  <span class="label">Fach</span>
  <input class="input" name="subject" value={subject} list="subjects" maxlength="80" placeholder="z. B. Biologie" />
  <datalist id="subjects">
    {#each subjects as s}<option value={s}></option>{/each}
  </datalist>
</label>
<label class="block">
  <span class="label">Eigene Notizen <span class="normal-case tracking-normal">(fließen in die Zusammenfassung ein)</span></span>
  <textarea class="input min-h-28" name="notes" placeholder="Stichpunkte, Hausaufgaben, Hinweise der Lehrkraft …">{notes}</textarea>
</label>
