/**
 * A line written in the sky.
 *
 * It carries the one sentence the world cannot teach by itself: what you are
 * meant to do in the mode you picked. It belongs in the sky rather than in a
 * dialog, because once you are inside the piece should have no interface left.
 * It fades once you have clearly understood it.
 */
import * as THREE from 'three';

// Ahead of the player rather than nailed to a point in the world: pinned to
// the sky over the origin it sat at about sixty degrees up, which means
// craning your neck to read it. Hung ahead at this distance and height it
// comes in at roughly twenty degrees, a glance rather than a stretch.
const AHEAD = 26;
const INSTRUCTION_HEIGHT = 9.5;
const ANNOUNCE_HEIGHT = 6.5;

const _ahead = new THREE.Vector3();
const _vec = new THREE.Vector3();

function textPlane(text, { size = 88, width = 2048, opacity = 0.5, italic = false }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round(size * 2.2);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${italic ? 'italic ' : ''}${size}px ui-serif, Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const aspect = canvas.width / canvas.height;
  const height = 7;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(height * aspect, height),
    new THREE.MeshBasicMaterial({
      map: texture, transparent: true, opacity,
      depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    })
  );
  mesh.renderOrder = -1;
  return mesh;
}

export class SkyText {
  constructor(scene, camera) {
    this.camera = camera;
    this.scene = scene;
    this.group = new THREE.Group();
    this.instruction = null;
    this.instructionUntil = 0;
    this.announcement = null;
    this.elapsed = 0;
    scene.add(this.group);
  }

  /**
   * The line for the mode just entered. Held for a while, then faded: long
   * enough to read twice, short enough that the sky is empty by the time you
   * are actually playing.
   */
  say(text, seconds = 14) {
    if (this.instruction) this.group.remove(this.instruction);
    this.instruction = textPlane(text, { size: 74, opacity: 0, italic: true });
    this.instruction.position.copy(this.camera.position);
    this.group.add(this.instruction);
    this.instructionUntil = this.elapsed + seconds;
  }

  /** Cut it short: the player has clearly understood. */
  dismiss() {
    this.instructionUntil = Math.min(this.instructionUntil, this.elapsed + 1.2);
  }

  /**
   * Say something once, briefly, then never again. Used to mark the moment the
   * song is whole, which otherwise passes without acknowledgement.
   */
  announce(text, seconds = 5) {
    if (this.announcement) this.group.remove(this.announcement);
    this.announcement = textPlane(text, { size: 58, opacity: 0, italic: true });
    this.announcement.scale.setScalar(0.7);
    this.announcement.position.copy(this.camera.position);
    this.group.add(this.announcement);
    this.announceUntil = this.elapsed + seconds;
  }

  update(dt) {
    this.elapsed += dt;

    const breath = 0.86 + Math.sin(this.elapsed * 0.35) * 0.14;

    // Where a line should hang right now: ahead of where you are facing.
    this.camera.getWorldDirection(_ahead);
    _ahead.y = 0;
    if (_ahead.lengthSq() < 1e-6) _ahead.set(0, 0, -1);
    _ahead.normalize().multiplyScalar(AHEAD).add(this.camera.position);

    const hang = (mesh, height) => {
      // Ease across so turning around does not teleport the words.
      mesh.position.lerp(
        _vec.set(_ahead.x, this.camera.position.y + height, _ahead.z),
        Math.min(1, dt * 1.1)
      );
      mesh.lookAt(this.camera.position.x, mesh.position.y, this.camera.position.z);
    };

    if (this.instruction) {
      const m = this.instruction.material;
      const target = this.elapsed < this.instructionUntil ? 0.52 : 0;
      m.opacity += (target * breath - m.opacity) * Math.min(1, dt * 1.4);
      hang(this.instruction, INSTRUCTION_HEIGHT);
      if (m.opacity < 0.01 && target === 0) {
        this.group.remove(this.instruction);
        this.instruction = null;
      }
    }

    if (this.announcement) {
      const a = this.announcement.material;
      const target = this.elapsed < this.announceUntil ? 0.5 : 0;
      a.opacity += (target * breath - a.opacity) * Math.min(1, dt * 1.6);
      hang(this.announcement, ANNOUNCE_HEIGHT);
      if (a.opacity < 0.01 && target === 0) {
        this.group.remove(this.announcement);
        this.announcement = null;
      }
    }

  }
}
