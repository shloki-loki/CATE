// Placeholder name and display name for the "Add a model or API" form.
// A preset is only called "(free)" when it really has a free tier (presets mark paid ones with `paid: true`).

export function isFreePreset(preset) {
  return Boolean(preset) && !preset.paid;
}

export function connectionPlaceholders({ runner, presetKey, preset, type }) {
  if (runner !== 'api') return { id: type?.id || '', label: type?.label || '' };
  const free = isFreePreset(preset);
  return {
    id: `${free ? 'free' : 'api'}-${presetKey}`,
    label: `${preset?.label || 'API'}${free ? ' (free)' : ''}`,
  };
}
