import { Stage } from './scene.js';
import { SpatialMix } from './audio.js';
import { buildEnvironment } from './environment.js';
import { buildMonument } from './monuments.js';
import { cacheUrl, getWorld, resolveWorldId } from './api.js';

const dom = {
  overlay: document.getElementById('overlay'),
  enter: document.getElementById('enter'),
  title: document.getElementById('world-title'),
  dedication: document.getElementById('world-dedication'),
  hud: document.getElementById('hud'),
  readout: document.getElementById('stem-readout'),
  meta: document.getElementById('meta'),
  controls: document.querySelector('.controls'),
};

async function boot() {
  const stage = new Stage(document.getElementById('stage'));

  let world;
  try {
    world = await getWorld(await resolveWorldId());
  } catch (error) {
    dom.enter.textContent = 'No world found';
    dom.dedication.textContent = String(error.message);
    console.error(error);
    return;
  }

  const base = cacheUrl(world.id);
  dom.title.textContent = world.title;
  dom.dedication.textContent = world.dedication;
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

  dom.enter.disabled = false;
  dom.enter.textContent = 'Step inside';
  dom.enter.addEventListener('click', () => {
    mix.start();
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
        ? 'W A S D to walk · drag to look · Esc to let go'
        : 'W A S D to walk · mouse to look · Esc to let go';
    }, 120);
  });
  stage.addEventListener('exit', () => {
    dom.overlay.classList.remove('hidden');
    dom.hud.classList.add('hidden');
    dom.enter.textContent = 'Back inside';
  });

  // Handy from the devtools console while tuning the mapping:
  //   __firstsong.mix.stems.map(s => [s.spec.name, s.level])
  window.__firstsong = { stage, mix, world, monuments, environment };

  let elapsed = 0;
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(stage.clock.getDelta(), 0.05);
    elapsed += dt;

    stage.step(dt);
    mix.update(stage.camera);

    for (const monument of monuments) {
      const stem = byName.get(monument.spec.name);
      monument.pulse(stem ? stem.level : 0, elapsed);
    }

    if (mix.playing) {
      const loudest = mix.dominant();
      dom.readout.innerHTML = mix.stems
        .map((stem) => {
          const width = Math.round(stem.level * 100);
          const strong = stem === loudest ? ' strong' : '';
          return `<div class="stem${strong}">
                    <span class="dot" style="background:${stem.spec.colour}"></span>
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
