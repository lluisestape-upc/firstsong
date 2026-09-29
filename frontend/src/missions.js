/**
 * Missions: small production jobs, each worth a star.
 *
 * The tutorial shows where the keys are; the missions ask for something a
 * producer would actually do ("put the singer in a cathedral") and leave the
 * how to the player. Each one is checked against the real state of the mix,
 * every frame, so the only way to earn the star is to make the sound. When it
 * lands, one line says what was just learned, then the next one appears.
 *
 * Stars are kept per song in this browser. M skips to the next unfinished
 * mission. The piece still works if storage is refused.
 */

function load(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
}

function save(key, done) {
  try { localStorage.setItem(key, JSON.stringify([...done])); } catch { /* private window */ }
}

const LESSON_SECONDS = 4.5;

export class Missions {
  /**
   * `list` is [{ id, text, keys?, lesson, check() }]. `ctx` is the song's
   * AudioContext, for the little chime a star makes.
   */
  constructor(root, list, { key, ctx = null }) {
    this.root = root;
    this.list = list;
    this.key = key;
    this.ctx = ctx;
    this.done = load(key);
    this.active = false;
    this.index = -1;
    this.lesson = 0;          // seconds left showing what was just learned
    this.fresh = null;        // the star just earned, so it can pop
    this.onStar = () => {};

    this.starsEl = root.querySelector('.missions-stars');
    this.textEl = root.querySelector('.missions-text');
    this.keysEl = root.querySelector('.missions-keys');
    this._pick(0);
    this._render();
  }

  get stars() {
    return this.list.filter((m) => this.done.has(m.id)).length;
  }

  get current() {
    return this.list[this.index] || null;
  }

  /** The first unfinished mission at or after `from`, wrapping round. */
  _pick(from) {
    const n = this.list.length;
    for (let k = 0; k < n; k++) {
      const i = (from + k) % n;
      if (!this.done.has(this.list[i].id)) { this.index = i; return; }
    }
    this.index = -1;
  }

  show(on) {
    this.active = on;
    this.root.classList.toggle('hidden', !on);
  }

  skip() {
    if (!this.active || this.lesson > 0 || this.index < 0) return;
    this._pick(this.index + 1);
    this._render(true);
  }

  _render(arrive = false) {
    const total = this.list.length;
    this.starsEl.innerHTML = this.list
      .map((m) => {
        const got = this.done.has(m.id) ? 'got' : '';
        return `<i class="${got}${m.id === this.fresh ? ' new' : ''}">★</i>`;
      }).join('')
      + `<span>${this.stars} / ${total}</span>`;

    if (this.lesson > 0) return;
    const mission = this.current;
    if (!mission) {
      this.textEl.textContent = 'Every star. That is what producers do all day.';
      this.keysEl.innerHTML = '';
    } else {
      this.textEl.textContent = mission.text;
      this.keysEl.innerHTML = (mission.keys || []).map((k) => `<kbd>${k}</kbd>`).join('')
        + (this.stars < total - 1 ? '<span class="missions-skip"><kbd>M</kbd> another</span>' : '');
    }
    this.root.classList.remove('learned');
    if (arrive) {
      this.root.classList.remove('arrive');
      void this.root.offsetWidth;
      this.root.classList.add('arrive');
    }
  }

  /** Two soft bell partials: a star should be heard as well as seen. */
  _chime() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    [[1318.5, 0], [1975.5, 0.09]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t + at);
      gain.gain.linearRampToValueAtTime(0.12, t + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 1.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + at);
      osc.stop(t + at + 1.3);
    });
  }

  update(dt) {
    if (!this.active) return;

    if (this.lesson > 0) {
      this.lesson -= dt;
      if (this.lesson <= 0) {
        this.fresh = null;
        this._pick(this.index);
        this._render(true);
      }
      return;
    }

    const mission = this.current;
    if (!mission || !mission.check()) return;

    this.done.add(mission.id);
    save(this.key, this.done);
    this.fresh = mission.id;
    this._chime();
    this.onStar(mission);
    this.lesson = LESSON_SECONDS;
    this._render();
    this.textEl.textContent = mission.lesson;
    this.keysEl.innerHTML = '';
    this.root.classList.add('learned');
    this.root.classList.remove('arrive');
    void this.root.offsetWidth;
    this.root.classList.add('arrive');
  }
}
