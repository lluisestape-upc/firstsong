import { Stage } from './scene.js';
import { SpatialMix } from './audio.js';
import { buildEnvironment } from './environment.js';
import { buildMonument } from './monuments.js';
import { Interaction } from './interaction.js';
import { Trail } from './trail.js';
import { Pad } from './pad.js';
import { SkyText } from './skytext.js';
import { BlindGame } from './blind.js';
import { Beat } from './beat.js';
import { Recorder } from './recorder.js';
import { cacheUrl, getWorld, listWorlds, resolveWorldId } from './api.js';

const dom = {
  overlay: document.getElementById('overlay'),
  enter: document.getElementById('enter'),
  title: document.getElementById('world-title'),
  hud: document.getElementById('hud'),
  songs: document.getElementById('songs'),
  modes: document.getElementById('modes'),
  pause: document.getElementById('pause'),
  readout: document.getElementById('stem-readout'),
  meta: document.getElementById('meta'),
  controls: document.querySelector('.controls'),
};

/** Offer the other worlds, if there is more than one. Switching reloads. */
async function renderChooser(currentId) {
  let worlds = [];
  try {
    worlds = await listWorlds();
  } catch {
    return;                       // one world only, or no index: no chooser
  }
  if (worlds.length < 2) return;

  dom.songs.hidden = false;
  dom.songs.innerHTML = worlds.map((w) => `
    <button class="song" data-id="${w.id}" aria-current="${w.id === currentId}"
            type="button">${w.title}</button>`).join('');

  for (const button of dom.songs.querySelectorAll('.song')) {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      if (id === currentId) return;
      location.search = `?world=${encodeURIComponent(id)}`;
    });
  }
}

const MODES = ['gather', 'wander', 'blind'];

// The one sentence each mode needs. It goes in the sky, not on the menu: the
// menu shows what a mode looks like, the world says what to do in it.
const INSTRUCTION = {
  gather: 'walk up to a shape to wake it',
  wander: 'where you stand is the mix',
  blind: 'find the sound, then press E',
};

function readMode() {
  const asked = new URLSearchParams(location.search).get('mode');
  return MODES.includes(asked) ? asked : 'gather';
}

function bindModes(onPick) {
  let current = readMode();
  const paint = () => {
    for (const button of dom.modes.querySelectorAll('.mode')) {
      button.setAttribute('aria-checked', String(button.dataset.mode === current));
    }
  };
  for (const button of dom.modes.querySelectorAll('.mode')) {
    button.addEventListener('click', () => {
      current = button.dataset.mode;
      paint();
      onPick(current);
    });
  }
  paint();
  return () => current;
}

async function boot() {
  const stage = new Stage(document.getElementById('stage'));

  let world;
  try {
    world = await getWorld(await resolveWorldId());
  } catch (error) {
    dom.enter.textContent = 'No world found';
    dom.title.textContent = String(error.message);
    console.error(error);
    return;
  }

  const base = cacheUrl(world.id);
  dom.title.textContent = world.title;
  dom.meta.textContent =
    `${world.mix.tempo} BPM · key ${world.mix.key} · ${world.stems.length} stems · ` +
    `${world.environment.provider}`;

  const environment = await buildEnvironment(stage.scene, world.environment, base);

  const monuments = await Promise.all(
    world.stems.map((spec) => buildMonument(spec, base))
  );
  for (const monument of monuments) stage.scene.add(monument.group);

  const mix = new SpatialMix();
  dom.enter.textContent = 'Decoding stems…';
  await mix.load(world, base, (done, total, name) => {
    dom.enter.textContent = `Decoding ${name} (${done}/${total})…`;
  });

  // Pair each monument with its stem by name.
  const byName = new Map(mix.stems.map((stem) => [stem.spec.name, stem]));

  const interaction = new Interaction(stage, mix, monuments);
  const trail = new Trail(stage.scene, world.environment.sky_bottom);
  const pad = new Pad(stage.scene, world.environment.sky_bottom);
  const sky = new SkyText(stage.scene, stage.camera);

  const blind = new BlindGame({ stage, mix, monuments, sky, pad, trail });
  const beat = new Beat(stage.scene, world.mix.beats, world.environment.sky_bottom);
  const recorder = new Recorder(stage);

  stage.addEventListener('replay', () => {
    if (recorder.playing) { recorder.stop(); return; }
    if (recorder.play()) sky.announce('again, the way you walked it', 4);
  });
  const currentMode = bindModes(() => {});

  stage.addEventListener('takeOrPlace', () => {
    // In Blind the same key commits to a spot instead of picking things up.
    if (blind.active) { blind.guess(); return; }
    if (interaction.takeOrPlace()) sky.dismiss();
  });

  // The sky acknowledges the song coming back together, then gets out of the way.
  interaction.onChange = (what) => {
    // Waking the first one proves the instruction landed.
    if (what === 'discovered') sky.dismiss();
    if (what === 'assembled') sky.announce('all of it, together');
  };
  stage.addEventListener('hushOrWake', () => interaction.hushOrWake());
  stage.addEventListener('soloStart', () => interaction.startSolo());
  stage.addEventListener('soloEnd', () => interaction.endSolo());

  // Land a jump on the pad and the world goes back to how it was found.
  stage.addEventListener('land', () => {
    // Every landing answers the beat; only a landing on the pad resets.
    beat.land(mix.songTime(), stage.camera.position);
    if (!pad.contains(stage.camera.position)) return;
    pad.fire();
    interaction.reset();
    trail.clear();
  });

  dom.enter.disabled = false;
  dom.enter.textContent = 'Step inside';
  let started = false;
  dom.enter.addEventListener('click', async () => {
    const mode = currentMode();
    if (mix.playing) {
      await mix.resume();
    } else {
      mix.start();
      started = true;
    }
    // Picking a mode from the card always (re)starts that mode, so a judge can
    // try all three without reloading.
    sky.say(INSTRUCTION[mode]);
    if (mode === 'blind') {
      blind.start();
    } else {
      if (blind.active) blind.active = false;
      if (mode === 'gather' && !interaction.everGathered) {
        interaction.beginAsleep();
        interaction.everGathered = true;
      }
    }
    setPauseLabel();
    stage.enter();
  });

  // The HUD follows entering the world, not pointer lock: if the browser
  // refuses to capture the cursor the piece must still be playable.
  stage.addEventListener('enter', () => {
    dom.overlay.classList.add('hidden');
    dom.hud.classList.remove('hidden');
    // One frame later the pointerlockchange event has settled.
    setTimeout(() => {
      dom.controls.textContent = stage.needsDragHint
        ? 'W A S D to walk · drag to look · E take · Q hush · Esc to let go'
        : 'W A S D to walk · mouse to look · E take · Q hush · Esc to let go';
    }, 120);
  });
  const setPauseLabel = () => {
    dom.pause.textContent = mix.paused ? 'Play the song' : 'Stop the song';
  };
  dom.pause.addEventListener('click', async (event) => {
    event.stopPropagation();
    await mix.togglePause();
    setPauseLabel();
  });

  stage.addEventListener('exit', async () => {
    // Letting go stops the song too: nobody wants it playing at a menu.
    await mix.pause();
    setPauseLabel();
    dom.overlay.classList.remove('hidden');
    dom.hud.classList.add('hidden');
    dom.enter.textContent = 'Back inside';
  });

  // Handy from the devtools console while tuning the mapping:
  //   __firstsong.mix.stems.map(s => [s.spec.name, s.level])
  await renderChooser(world.id);
  window.__firstsong = {
    stage, mix, world, monuments, environment, interaction, trail, pad, sky,
    blind, beat, recorder,
  };

  let elapsed = 0;
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(stage.clock.getDelta(), 0.05);
    elapsed += dt;

    // While a replay is running it drives the camera and input is ignored.
    const replaying = recorder.update(dt);
    if (!replaying) {
      stage.step(dt);
      recorder.record(dt, mix.songTime());
    }
    interaction.update();
    mix.update(stage.camera);
    if (stage.active) trail.update(stage.camera.position);
    blind.update(dt);
    beat.update(dt);
    pad.update(stage.camera.position, dt, !blind.active && interaction.dirty);
    sky.update(dt);
    // One discovery at a time: while the song is still being assembled, the
    // sky says nothing about carrying.

    for (const monument of monuments) {
      const stem = byName.get(monument.spec.name);
      monument.pulse(stem ? stem.level : 0, elapsed, dt);
    }

    if (mix.playing) {
      const loudest = mix.dominant();
      dom.readout.innerHTML = mix.stems
        .map((stem) => {
          const width = Math.round(stem.level * 100);
          const held = interaction.carrying?.spec.name === stem.spec.name;
          const near = interaction.focus?.spec.name === stem.spec.name;
          const strong = held || near || stem === loudest ? ' strong' : '';
          const dot = stem.muted ? 'transparent' : stem.spec.colour;
          const ring = stem.muted ? `box-shadow:inset 0 0 0 1px ${stem.spec.colour}` : '';
          return `<div class="stem${strong}${held ? ' held' : ''}">
                    <span class="dot" style="background:${dot};${ring}"></span>
                    <span class="name">${stem.spec.name}</span>
                    <span class="bar"><i style="width:${width}%;background:${stem.spec.colour}"></i></span>
                  </div>`;
        })
        .join('');
    }

    stage.render();
  }
  frame();
}

boot();
