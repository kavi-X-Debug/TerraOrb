// Sound for the Rain Cloud game and the Tank Farmer game. Everything is made live in the browser with the Web Audio API,
// so there are no sound files to download and no music licences to worry about.
//
//   music     a calm, slow tune in a pentatonic scale (soft plucks, a bass note and a pad on a 4-chord loop)
//   sea       gentle rolling waves while you fly over the sea
//   rain      soft rain noise while the cloud is raining
//   chimes    a little "ding" when a tank is full, and a short happy tune at the end
//
// Two tunes: "cloud" (calm, with sea waves) and "farm" (lighter and bouncier, for Tank Farmer, with pop and sip sounds).
// The browser only allows sound after a tap, so createAudio() is called from the Play button.
// Nothing is saved except the "music on / off" choice.
const MIDI = (n) => 440 * Math.pow(2, (n - 69) / 12);
const STYLES = {
  cloud: { beat: 0.62, base: 60, sea: 0.05, chance: [0.5, 0.78],                                                   // C, Am, F, G (bass note first)
           chords: [[48, 55, 60, 64], [45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59]] },
  farm: { beat: 0.46, base: 67, sea: 0, chance: [0.62, 0.8],                                                       // G, Em, C, D: brighter and bouncier
          chords: [[43, 50, 55, 59], [40, 47, 52, 55], [36, 43, 48, 52], [38, 45, 50, 54]] },
};
const PENTA = [0, 2, 4, 7, 9];                                                              // C major pentatonic: every note sounds good together

export function createAudio(startMuted, style = "cloud") {
  const ST = STYLES[style] || STYLES.cloud, BEAT = ST.beat, CHORDS = ST.chords;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ac = new AC();
  const master = ac.createGain();
  master.gain.value = startMuted ? 0 : 0.55;
  master.connect(ac.destination);

  // a soft echo so the notes sound roomy
  const echo = ac.createDelay(1);
  echo.delayTime.value = BEAT * 0.75;
  const feedback = ac.createGain(); feedback.gain.value = 0.38;
  const wet = ac.createGain(); wet.gain.value = 0.32;
  echo.connect(feedback); feedback.connect(echo); echo.connect(wet); wet.connect(master);
  const bus = ac.createGain(); bus.gain.value = 0.9;
  bus.connect(master); bus.connect(echo);

  // noise for the sea and the rain
  const noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const noise = () => { const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };

  const seaFilter = ac.createBiquadFilter(); seaFilter.type = "lowpass"; seaFilter.frequency.value = 520;
  const seaGain = ac.createGain(); seaGain.gain.value = ST.sea;
  noise().connect(seaFilter); seaFilter.connect(seaGain); seaGain.connect(master);
  const swell = ac.createOscillator(); swell.frequency.value = 0.11;                // the waves slowly rise and fall
  const swellDepth = ac.createGain(); swellDepth.gain.value = ST.sea * 0.7;
  swell.connect(swellDepth); swellDepth.connect(seaGain.gain); swell.start();

  const rainFilter = ac.createBiquadFilter(); rainFilter.type = "highpass"; rainFilter.frequency.value = 1800;
  const rainGain = ac.createGain(); rainGain.gain.value = 0;
  noise().connect(rainFilter); rainFilter.connect(rainGain); rainGain.connect(master);

  // ---- one soft plucked note ----
  function note(freq, when, dur, vol, type = "triangle") {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(bus);
    o.start(when); o.stop(when + dur + 0.05);
  }
  function pad(freqs, when, dur) {
    freqs.forEach((f) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(0.035, when + dur * 0.35);
      g.gain.linearRampToValueAtTime(0.0001, when + dur);
      o.connect(g); g.connect(bus);
      o.start(when); o.stop(when + dur + 0.05);
    });
  }

  // ---- the tune: scheduled a little ahead of time, one eighth note at a time ----
  let phase = "sea", step = 0, next = ac.currentTime + 0.15, last = 3, timer = null;
  function schedule() {
    while (next < ac.currentTime + 0.5) {
      const bar = Math.floor(step / 8) % CHORDS.length, chord = CHORDS[bar];
      if (step % 8 === 0) {
        note(MIDI(chord[0]), next, BEAT * 3.6, 0.22, "sine");                         // bass
        pad(chord.slice(1).map(MIDI), next, BEAT * 4);
      }
      const eighth = BEAT / 2;
      const chance = phase === "land" ? ST.chance[1] : ST.chance[0];                                    // a busier tune over the land
      if (Math.random() < chance) {
        last = Math.max(0, Math.min(PENTA.length * 2 - 1, last + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]));
        const midi = ST.base + 12 + PENTA[last % PENTA.length] + 12 * Math.floor(last / PENTA.length) - 12;
        note(MIDI(midi), next, BEAT * (style === "farm" ? 0.9 : 1.4), 0.16);
      }
      if (phase === "land" && step % 2 === 0) note(MIDI(chord[1] + 24), next, BEAT * 0.6, 0.05, "sine");       // sparkly arpeggio
      next += eighth; step++;
    }
  }
  timer = setInterval(schedule, 120);
  schedule();

  const onVisible = () => { if (document.hidden) ac.suspend?.(); else ac.resume?.(); };
  document.addEventListener("visibilitychange", onVisible);
  ac.resume?.();

  return {
    setPhase(p) {
      phase = p;
      seaGain.gain.setTargetAtTime(p === "sea" ? ST.sea : ST.sea * 0.24, ac.currentTime, 0.8);
    },
    setRain(on) { rainGain.gain.setTargetAtTime(on ? 0.16 : 0, ac.currentTime, 0.2); },
    setMuted(m) { master.gain.setTargetAtTime(m ? 0 : 0.55, ac.currentTime, 0.08); },
    pop() {                                                                            // a raindrop is caught: a short bubbly "blip"
      const t0 = ac.currentTime, f = MIDI(ST.base + 24 + PENTA[Math.floor(Math.random() * 5)]);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(f * 0.7, t0); o.frequency.exponentialRampToValueAtTime(f * 1.4, t0 + 0.08);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.28, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.2);
    },
    power() {                                                                          // a special drop: a quick sparkly climb
      const t0 = ac.currentTime;
      [79, 83, 86, 91].forEach((m, i) => note(MIDI(m), t0 + i * 0.07, 0.5, 0.2, "sine"));
    },
    sip() {                                                                            // a crop drinks: a quick gulping glide down
      const t0 = ac.currentTime;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "triangle"; o.frequency.setValueAtTime(520, t0); o.frequency.exponentialRampToValueAtTime(190, t0 + 0.22);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.3);
    },
    chime() {                                                                          // a tank is full
      const t0 = ac.currentTime;
      [76, 83, 88].forEach((m, i) => note(MIDI(m), t0 + i * 0.09, 0.9, 0.2, "sine"));
    },
    win() {                                                                            // the end tune
      const t0 = ac.currentTime;
      [72, 76, 79, 84, 79, 84, 88].forEach((m, i) => note(MIDI(m), t0 + 0.1 + i * 0.16, 1.1, 0.2, "triangle"));
    },
    stop(after = 0) {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      rainGain.gain.setTargetAtTime(0, ac.currentTime, 0.1);
      seaGain.gain.setTargetAtTime(0, ac.currentTime, 0.3);
      setTimeout(() => ac.close?.().catch(() => {}), after);
    },
  };
}
