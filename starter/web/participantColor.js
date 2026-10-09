// User IDs keep a person's colour consistent across clients and reconnects.
export function participantColor(userId) {
  let hash = 2166136261;
  for (const character of userId) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  const unsigned = hash >>> 0;
  const hue = Number((unsigned % 360 + (unsigned % 10000) / 10000).toFixed(4));
  return {
    '--participant-color': `hsl(${hue} 44% 28%)`,
    '--participant-soft': `hsl(${hue} 38% 94%)`,
    '--participant-avatar': `hsl(${hue} 38% 88%)`,
    '--participant-border': `hsl(${hue} 30% 79%)`,
  };
}
