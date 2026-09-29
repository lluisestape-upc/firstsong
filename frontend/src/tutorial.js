/**
 * The first time through a mode, one thing at a time.
 *
 * Every step waits for you to actually do the thing, never for a timer: the
 * world teaches by being used, and a step that moved on by itself would be
 * teaching nothing. Each one names its keys, and the next only appears once
 * the last has been done.
 *
 * Finishing it (or pressing H) is remembered in this browser, so the second
 * visit is left alone. The piece still works if storage is refused.
 *
 * There can be more than one. Discover teaches everything; Play only the
 * table. Finishing Discover also counts as having learned the table (`covers`),
 * so a Discover graduate is never taught it twice.
 */

function remembered(key) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function remember(key) {
  try { localStorage.setItem(key, '1'); } catch { /* private window */ }
}

export class Tutorial {
  /**
   * `steps` is a list of { text, keys, done(), progress?() }. `done` is asked
   * every frame; `progress` may return a short "2 of 4" for steps that repeat.
   * `onStart` runs each time it begins, so the steps can count from there.
   */
  constructor(root, steps, { key = 'firstsong.tutorial.done', covers = [], onStart = () => {} } = {}) {
    this.root = root;
    this.steps = steps;
    this.key = key;
    this.covers = covers;
    this.onStart = onStart;
    this.index = -1;
    this.active = false;
    this.hold = 0;           // a beat of acknowledgement before the next step

    this.textEl = root.querySelector('.tutorial-text');
    this.keysEl = root.querySelector('.tutorial-keys');
    this.countEl = root.querySelector('.tutorial-count');
    this.dotsEl = root.querySelector('.tutorial-dots');

    document.addEventListener('keydown', (event) => {
      if (this.active && event.code === 'KeyH') this.finish();
    });
  }

  get seen() {
    return remembered(this.key);
  }

  start(force = false) {
    if (!force && this.seen) return false;
    this.onStart();
    this.active = true;
    this.hold = 0;
    this.index = -1;
    this.dotsEl.innerHTML = this.steps.map(() => '<i></i>').join('');
    this.root.classList.remove('hidden');
    this._next();
    return true;
  }

  finish() {
    this.active = false;
    for (const key of [this.key, ...this.covers]) remember(key);
    this.root.classList.add('hidden');
  }

  /** Put it away without counting it as done: another mode was chosen. */
  stop() {
    if (!this.active) return;
    this.active = false;
    this.hold = 0;
    this.root.classList.add('hidden');
  }

  _next() {
    this.index++;
    if (this.index >= this.steps.length) {
      this.finish();
      return;
    }
    const step = this.steps[this.index];
    this.textEl.textContent = step.text;
    this.keysEl.innerHTML = (step.keys || [])
      .map((k) => `<kbd>${k}</kbd>`).join('');
    this.countEl.textContent = '';
    [...this.dotsEl.children].forEach((dot, i) => {
      dot.className = i < this.index ? 'done' : i === this.index ? 'now' : '';
    });
    // Restart the entrance animation so a new step is noticed.
    this.root.classList.remove('arrive');
    void this.root.offsetWidth;
    this.root.classList.add('arrive');
  }

  update(dt) {
    if (!this.active) return;
    const step = this.steps[this.index];
    if (step.progress) this.countEl.textContent = step.progress() || '';

    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold <= 0) this._next();
      return;
    }
    if (step.done()) {
      this.root.classList.add('ticked');
      setTimeout(() => this.root.classList.remove('ticked'), 500);
      this.hold = 0.7;
    }
  }
}
