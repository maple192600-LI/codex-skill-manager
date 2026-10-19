const normalized=s=>String(s||'').replaceAll('\\','/').toLowerCase();
export function skillPathKey(value) {
  const full=normalized(value);
  // Cache versions change during normal plugin upgrades; repository and skill path remain stable.
  return full.replace(/(\/plugins\/cache\/[^/]+\/[^/]+)\/[^/]+\//,'$1/*/');
}
