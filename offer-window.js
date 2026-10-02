(function(root){
  function locked(state, now = Date.now()) {
    const schedule = state.offerSchedule || {};
    const closes = Date.parse(schedule.closesAt || '');
    // Preserve windows already closed when scheduling was retired; future schedules are ignored.
    if (Number.isFinite(closes) && closes <= 1790969643659 && now >= closes) return true;
    return !!state.offersLocked;
  }
  function localTime(instant, zone) {
    if (!instant) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
    const p = Object.fromEntries(parts.map(p => [p.type,p.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  }
  function toUTC(local, zone) {
    if (!local) return '';
    const guess = Date.parse(local + 'Z');
    if (!Number.isFinite(guess)) throw Error('Enter a valid date and time.');
    const matches = new Set();
    for (const hours of [-36,-12,0,12,36]) {
      const sample = guess + hours * 3600000;
      const offset = Date.parse(localTime(sample,zone) + 'Z') - sample;
      const candidate = guess - offset;
      if (localTime(candidate,zone) === local) matches.add(new Date(candidate).toISOString());
    }
    if (matches.size !== 1) throw Error(matches.size ? 'This time occurs twice when daylight saving ends. Choose a time outside that repeated hour.' : 'This local time does not exist because of daylight saving. Choose another time.');
    return [...matches][0];
  }
  function validate(schedule) {
    if (!schedule) return '';
    try { new Intl.DateTimeFormat('en', {timeZone:schedule.timezone || 'UTC'}); } catch { return 'Choose a valid timezone.'; }
    for (const field of ['closesAt']) if (schedule[field] && !Number.isFinite(Date.parse(schedule[field]))) return 'Enter valid schedule dates.';
    return '';
  }
  root.NZCFLOfferWindow = Object.freeze({locked,localTime,toUTC,validate});
})(globalThis);
