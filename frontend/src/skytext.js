/**
 * A line written in the sky.
 *
 * The dedication belongs in the world, not in a dialog: once you are inside,
 * the piece should not have any interface left. A second, fainter line carries
 * the one thing the world cannot teach by itself, and it is gone for good the
 * moment you work it out.
 */
import * as THREE from 'three';

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
  /** Writes `dedication` permanently, and `hint` until dismiss() is called. */
  constructor(scene, camera, dedication, hint) {
    this.camera = camera;
    this.group = new THREE.Group();

    this.dedication = textPlane(dedication, { size: 84, opacity: 0.0, italic: true });
    this.dedication.position.set(0, 26, 0);
    this.group.add(this.dedication);

    this.hint = hint ? textPlane(hint, { size: 54, opacity: 0.0 }) : null;
    if (this.hint) {
      this.hint.scale.setScalar(0.62);
      this.hint.position.set(0, 20, 0);
      this.group.add(this.hint);
    }

    this.dedicationTarget = 0.5;
    this.hintTarget = 0;
    this.dismissed = false;
    this.elapsed = 0;
    scene.add(this.group);
  }

  /**
   * Say something once, briefly, then never again. Used to mark the moment the
   * song is whole, which otherwise passes without acknowledgement.
   */
  announce(text, seconds = 5) {
    if (this.announcement) this.group.remove(this.announcement);
    this.announcement = textPlane(text, { size: 58, opacity: 0, italic: true });
    this.announcement.scale.setScalar(0.7);
    this.announcement.position.set(0, 20, 0);
    this.group.add(this.announcement);
    this.announceUntil = this.elapsed + seconds;
  }

  /** Show the hint. Ignored once the player has proved they do not need it. */
  showHint(show = true) {
    if (this.dismissed) return;
    this.hintTarget = show ? 0.42 : 0;
  }

  /** The player took something: the hint has done its job, permanently. */
  dismiss() {
    this.dismissed = true;
    this.hintTarget = 0;
  }

  update(dt) {
    this.elapsed += dt;

    // Both lines sit in the sky ahead of wherever you are looking, always
    // legible, never in the way.
    const yaw = Math.atan2(
      this.camera.position.x - this.group.position.x || 0, 1
    );
    this.group.rotation.y = yaw;
    for (const mesh of [this.dedication, this.hint]) {
      if (!mesh) continue;
      mesh.lookAt(this.camera.position.x, mesh.position.y - 6, this.camera.position.z);
    }

    // Fade in slowly, and breathe, so the sky does not read as a UI layer.
    const breath = 0.86 + Math.sin(this.elapsed * 0.35) * 0.14;
    const ease = Math.min(1, dt * 1.2);
    const d = this.dedication.material;
    d.opacity += (this.dedicationTarget * breath - d.opacity) * ease;

    if (this.announcement) {
      const a = this.announcement.material;
      const target = this.elapsed < this.announceUntil ? 0.5 : 0;
      a.opacity += (target * breath - a.opacity) * Math.min(1, dt * 1.6);
      this.announcement.lookAt(
        this.camera.position.x, this.announcement.position.y - 6, this.camera.position.z
      );
      if (a.opacity < 0.01 && target === 0) {
        this.group.remove(this.announcement);
        this.announcement = null;
      }
    }

    if (this.hint) {
      const h = this.hint.material;
      h.opacity += (this.hintTarget * breath - h.opacity) * Math.min(1, dt * 2.5);
      this.hint.visible = h.opacity > 0.01;
    }
  }
}
