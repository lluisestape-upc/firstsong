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
import { Course } from './course.js';
import { Recorder } from './recorder.js';
import { Words } from './words.js';
import { Table, TABLE_HEIGHT } from './table.js';
import { Inspector } from './inspect.js';
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

// Discover and Play are the two on the menu. The rest are still here, reached
// with ?mode=, while it is decided whether they come back.
const MODES = ['discover', 'play', 'gather', 'wander', 'pulse', 'echo', 'blind'];
const TABLE_MODES = new Set(['discover', 'play']);

// The one sentence each mode needs. It goes in the sky, not on the menu: the
// menu shows what a mode looks like, the world says what to do in it.
const INSTRUCTION = {
  discover: 'walk up to an instrument and press F',
  play: 'the table in the middle is yours',
  gather: 'walk up to a shape to wake it',
  wander: 'where you stand is the mix',
  echo: 'walk a while, then press R',
  blind: 'find the sound, then press E',
};

// Pulse writes its own line instead, once per level, pinned over the platform
// the run starts from. Nothing here follows the camera.
const LEVEL_LINES = [
  'jump when it flashes',
  'only a jump on the beat will reach',
  'every crossing brings a voice back',
  'stay in time',
  'keep the run going',
  'the last of it',
];
const levelLine = (n) => LEVEL_LINES[Math.min(n, LEVEL_LINES.length) - 1];

/** Aim the walker at a point on the ground. */
function faceTowards(stage, from, to) {
  stage.yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
  // Tipped down a little: on a course the thing you need to see is at your
  // own feet's height, and level with the horizon it sits at the very bottom
  // of the screen.
  stage.pitch = -0.16;
}

function readMode() {
  const asked = new URLSearchParams(location.search).get('mode');
  return MODES.includes(asked) ? asked : 'discover';
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

  // The lyrics' objects download while the stems decode: neither waits on
  // the other.
  const words = new Words(stage.scene, world.words || [], base);
  const wordsReady = words.load();

  const mix = new SpatialMix();
  dom.enter.textContent = 'Decoding stems…';
  await mix.load(world, base, (done, total, name) => {
    dom.enter.textContent = `Decoding ${name} (${done}/${total})…`;
  });
  await wordsReady;

  // Pair each monument with its stem by name.
  const byName = new Map(mix.stems.map((stem) => [stem.spec.name, stem]));
  const singer = monuments.find((m) => m.spec.name === 'vocals');
  const voice = byName.get('vocals');

  const interaction = new Interaction(stage, mix, monuments);
  const trail = new Trail(stage.scene, world.environment.sky_bottom);
  const pad = new Pad(stage.scene, world.environment.sky_bottom);
  const sky = new SkyText(stage.scene, stage.camera);

  const blind = new BlindGame({ stage, mix, monuments, sky, pad, trail });
  const beat = new Beat(stage.scene, world.mix.beats, world.environment.sky_bottom);
  const course = new Course(stage.scene, world.environment.sky_bottom);
  const recorder = new Recorder(stage);

  // One level per stem that starts the mode asleep, so the last crossing is
  // the one that finishes the song.
  const PULSE_LEVELS = Math.max(1, world.stems.length - 1);

  const table = new Table({
    scene: stage.scene, stage, mix, monuments, bpm: world.mix.tempo,
  });
  const inspector = new Inspector({ stage, table, mix });
  const TABLE_SIGN = 'set an effect next to an instrument';
  // Read from a few metres away, not twenty like Pulse's signs, so it is
  // hung low and small, just over the table.
  const pinTableSign = () => sky.pin(TABLE_SIGN, { x: 0, y: TABLE_HEIGHT, z: 0 },
                                     { height: 1.35, scale: 0.075 });

  table.onChange = (what) => {
    if (inspector.active) inspector.draw();
    if (what === 'take') sky.dismiss();
  };
  // The sign goes up when the table comes down, not before: in Discover there
  // is nothing to explain until there is a table to explain.
  table.onLanded = pinTableSign;

  stage.addEventListener('replay', () => {
    if (recorder.playing) { recorder.stop(); return; }
    if (!recorder.play()) return;
    // Over the same stretch of the track it was walked to, or it would be a
    // different mix from the one the walk actually made.
    mix.seek(recorder.songStart);
    trail.clear();
    sky.announce('again, the way you walked it', 4);
  });
  const currentMode = bindModes(() => {});

  // Which game is running, so that coming back in from the menu continues it
  // rather than starting it over. Picking a different mode does restart.
  let running = null;
  let echoNudged = false;

  function startMode(mode) {
    // Pulse is the one mode where walking up to a sleeping shape does nothing:
    // there the only way back into the song is to land on the beat. It is also
    // the only one with anything to stand on above the plain, and the only one
    // where the song decides how high a jump goes.
    interaction.wakeOnApproach = mode !== 'pulse' && mode !== 'discover';
    if (mode === 'pulse') {
      stage.groundAt = (x, z, feet) => course.heightAt(x, z, feet);
      stage.jumpPower = () => beat.liftAt(mix.songTime());
    } else {
      stage.groundAt = () => 0;
      stage.jumpPower = () => 1;
      // Leaving Pulse from halfway up the climb: set down on the pad rather
      // than dropped out of the sky onto a plain that just appeared.
      if (stage.altitude > 0.5) stage.placeAt(0, 0, 0);
      course.clear();
      if (mode !== running) sky.unpin();
    }
    // The table and the pad both want the middle of the world.
    pad.group.visible = !TABLE_MODES.has(mode);
    if (!TABLE_MODES.has(mode)) table.hide();

    if (mode !== 'blind' && blind.active) blind.active = false;
    if (mode !== 'pulse') sky.say(INSTRUCTION[mode]);

    const fresh = mode !== running || (mode === 'blind' && !blind.active);
    running = mode;
    if (!fresh) return;

    switch (mode) {
      case 'discover':
        // Silence, and a table still up in the sky. Every instrument found
        // brings its layer in; finding the last one brings the table down.
        interaction.wakeOnApproach = false;
        interaction.reset();
        interaction.sleepAll();
        table.hide();
        stage.placeAt(0, 0, 0);
        break;
      case 'play':
        interaction.wakeAll();
        interaction.reset();
        table.show();
        pinTableSign();
        stage.placeAt(0, 0, 4.4);
        stage.yaw = 0;
        stage.pitch = -0.22;
        break;
      case 'blind':
        blind.start();
        break;
      case 'gather':
        interaction.beginAsleep();
        break;
      case 'pulse': {
        beat.reset();
        interaction.beginAsleep('drums');
        // Clear of the skyline, whatever this song happened to build.
        const skyline = Math.max(...monuments.map((m) => m.top));
        const first = course.start(skyline + 1.9);
        stage.placeAt(first.x, first.h, first.z);
        faceTowards(stage, first, course.platforms[1]);
        sky.pin(levelLine(1), course.signSpotFor(first), { height: 0 });
        break;
      }
      case 'echo':
        // A clean sheet: the mix you are about to hear should be the walk you
        // are about to take, not whatever wandering came before it.
        interaction.wakeAll();
        interaction.reset();
        recorder.clear();
        trail.clear();
        echoNudged = false;
        break;
      default:
        // Wander is the world as it was built: whole, and nothing asleep.
        interaction.wakeAll();
        interaction.reset();
        break;
    }
  }

  stage.addEventListener('takeOrPlace', () => {
    // In Blind the same key commits to a spot instead of picking things up.
    if (blind.active) { blind.guess(); return; }
    if (inspector.active) return;
    // At the table, E moves effects; anywhere else it carries monuments.
    if (table.takeOrPlace()) return;
    if (interaction.takeOrPlace()) sky.dismiss();
  });

  // Enter: go inside the effect you are pointing at, or come back out.
  stage.addEventListener('inspect', () => {
    if (inspector.active) { inspector.close(); return; }
    const puck = table.carrying || table.aimed;
    if (!puck) return;
    if (table.carrying) table.takeOrPlace();     // set it down first
    inspector.open(puck);
  });

  // The sky acknowledges the song coming back together, then gets out of the way.
  interaction.onChange = (what) => {
    // Waking the first one proves the instruction landed.
    if (what === 'discovered') sky.dismiss();
    // Discover's reward for finding every instrument is the table itself.
    if (what === 'assembled' && running === 'discover') {
      table.drop();
      return;
    }
    // Pulse says this itself, in its own pinned line over the last platform.
    if (what === 'assembled' && running !== 'pulse') {
      sky.announce('all of it, together');
    }
  };
  stage.addEventListener('hushOrWake', () => interaction.hushOrWake());

  // F is "listen": to one instrument alone, to one effect alone from inside
  // it, and in Discover, to an instrument for the first time.
  stage.addEventListener('soloStart', () => {
    if (inspector.active) { inspector.listen(true); return; }
    if (running === 'discover') {
      const target = interaction.nearestAny();
      if (target && interaction.sleeping.has(target.spec.name)) {
        interaction.wake(target, 0.6);
        return;
      }
    }
    interaction.startSolo();
  });
  stage.addEventListener('soloEnd', () => {
    if (inspector.active) { inspector.listen(false); return; }
    interaction.endSolo();
  });

  // Land a jump on the pad and the world goes back to how it was found.
  stage.addEventListener('land', (event) => {
    // Every landing answers the beat; only a landing on the pad resets.
    beat.land(mix.songTime(), stage.camera.position);

    if (running === 'pulse') {
      const here = stage.camera.position;
      const result = course.landed(here.x, here.z, event.detail?.altitude ?? 0);

      if (result.kind === 'ground') {
        // Fell. Back to the last disc you actually stood on, which costs you
        // the crossing and nothing else: the song never stops.
        const back = course.checkpoint;
        if (back) {
          stage.placeAt(back.x, back.h, back.z);
          const ahead = course.target;
          if (ahead && ahead !== back) faceTowards(stage, back, ahead);
        }
      } else if (result.kind === 'level') {
        interaction.wakeOne();
        const from = course.goal;      // this disc becomes the next run's start
        const more = course.nextLevel(PULSE_LEVELS);
        sky.pin(more ? levelLine(course.level) : 'all of it, together',
                course.signSpotFor(from), { height: 0 });
      }
      return;                          // the pad plays no part up here
    }

    if (blind.active) return;         // mid-round, the pad is not in play
    if (!pad.group.visible) return;   // the table has the middle in these modes
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
    // Picking a different mode from the card starts it; picking the one that
    // is already running just drops you back into it.
    startMode(mode);
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
        ? 'W A S D walk · drag to look · F listen · E take · Enter inside an effect · Esc let go'
        : 'W A S D walk · mouse to look · F listen · E take · Enter inside an effect · Esc let go';
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
    inspector.cancel();
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
    blind, beat, course, recorder, words, table, inspector,
  };

  let elapsed = 0;
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(stage.clock.getDelta(), 0.05);
    elapsed += dt;

    // While a replay runs, or while you are inside an effect, something else
    // holds the camera and walking is ignored.
    const inspecting = inspector.update(dt);
    const replaying = !inspecting && recorder.update(dt);
    if (!replaying && !inspecting) {
      stage.step(dt);
      table.push(stage.camera.position);
      recorder.record(dt, mix.songTime());
    }
    table.update(dt, mix.songTime());
    interaction.update(dt);
    mix.update(stage.camera);
    if (stage.active) trail.update(stage.camera.position);
    blind.update(dt);

    // The words leave the singer, wherever the singer has been carried to,
    // and only while the singer can be heard.
    if (singer) words.origin.copy(singer.group.position).setY(singer.top * 0.8);
    words.setVisible(!blind.active);
    words.update(dt, mix.songTime(), mix.playing && (!voice || !voice.muted));
    beat.update(dt);
    // The course blinks on the beat, which is the only teaching Pulse does.
    if (running === 'pulse') course.update(dt, beat.offsetFrom(mix.songTime()));
    pad.update(stage.camera.position, dt, !blind.active && interaction.dirty);

    // Echo: the first instruction has faded by the time there is a walk worth
    // hearing, so say it again once, at the moment it becomes true.
    if (running === 'echo' && !echoNudged && !recorder.playing
        && recorder.seconds > 20) {
      echoNudged = true;
      sky.say('press R to walk it again', 8);
    }
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
