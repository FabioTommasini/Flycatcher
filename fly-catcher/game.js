// Fly Catcher - Phaser 3 mobile web game
// All visuals are drawn procedurally with the Phaser Graphics API, and all
// sound is synthesized at runtime with the Web Audio API - no external
// image or audio files required.

const GAME_WIDTH = 480;
const GAME_HEIGHT = 800;

const FLY_COLORS = [0xd32f2f, 0xffb300, 0x8e24aa, 0x43a047];

// Frog texture geometry, shared so the tongue's launch point can be
// computed precisely from the same coordinates used to draw the mouth.
const FROG_TEX_W = 170;
const FROG_TEX_H = 150;
const FROG_CX = FROG_TEX_W / 2; // 85
const FROG_CY = 95;
const FROG_MOUTH_LOCAL_X = FROG_CX;
const FROG_MOUTH_LOCAL_Y = FROG_CY + 2; // matches the open-mouth cavity below

const POND_LILY_PADS = [
  [70, 140, 55], [370, 90, 40], [200, 230, 65],
  [60, 340, 45], [400, 300, 50], [260, 450, 60],
  [120, 560, 42], [380, 520, 38],
];

// ---- Procedural sound engine (Web Audio API, no external files) ----

const Sfx = {
  ctx: null,
  masterGain: null,
  muted: false,
  tunePlaying: false,
  tuneTimeout: null,

  init() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 1;
    this.masterGain.connect(this.ctx.destination);

    // iOS Safari sometimes leaves the context "running" but silent unless a
    // real buffer (not just an oscillator) is played inside the unlocking
    // gesture, so kick it with one silent sample as extra insurance.
    const kick = this.ctx.createBufferSource();
    kick.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    kick.connect(this.ctx.destination);
    kick.start(0);
  },

  // Safe to call repeatedly from any later user gesture - iOS Safari
  // occasionally needs more than one nudge before playback truly starts.
  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  },

  // A calm, slow melodic loop over a soft sustained pad, for the landing
  // page only - sine tones with gentle attacks and long releases rather
  // than a peppy plucked run.
  startTune() {
    if (!this.ctx || this.tunePlaying) return;
    this.tunePlaying = true;
    const ctx = this.ctx;

    const droneGain = ctx.createGain();
    droneGain.gain.value = 0;
    droneGain.gain.linearRampToValueAtTime(0.03, ctx.currentTime + 2);
    const drone1 = ctx.createOscillator();
    drone1.type = 'sine';
    drone1.frequency.value = 130.81; // C3
    const drone2 = ctx.createOscillator();
    drone2.type = 'sine';
    drone2.frequency.value = 196.0; // G3
    drone1.connect(droneGain);
    drone2.connect(droneGain);
    droneGain.connect(this.masterGain);
    drone1.start();
    drone2.start();
    this.tuneDrone = { drone1, drone2, droneGain };

    const notes = [392.0, 440.0, 523.25, 440.0, 392.0, 329.63]; // G4 A4 C5 A4 G4 E4
    let i = 0;
    const noteGap = 550; // ms - slow, relaxed tempo

    const playNote = () => {
      if (!this.tunePlaying) return;
      const t0 = ctx.currentTime;
      const freq = notes[i % notes.length];
      i++;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1800;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.1, t0 + 0.12); // gentle fade in
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.85); // long, soft fade out

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t0);
      osc.stop(t0 + 0.9);

      this.tuneTimeout = setTimeout(playNote, noteGap);
    };
    playNote();
  },

  stopTune() {
    this.tunePlaying = false;
    if (this.tuneTimeout) {
      clearTimeout(this.tuneTimeout);
      this.tuneTimeout = null;
    }
    if (this.tuneDrone) {
      const { drone1, drone2, droneGain } = this.tuneDrone;
      const t1 = this.ctx.currentTime + 1;
      droneGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
      drone1.stop(t1);
      drone2.stop(t1);
      this.tuneDrone = null;
    }
  },

  // Quick descending "thwip" for the tongue launching out of the mouth.
  playTongueShoot() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(560, t0);
    osc.frequency.exponentialRampToValueAtTime(140, t0 + 0.12);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(t0);
    osc.stop(t0 + 0.16);
  },

  // A real frog call is a rapid buzzy pulse train (the vocal sac fluttering),
  // not a smooth tone - shaped through two formant-like bandpass filters for
  // a nasal "ribbit" honk, as a rising "rib" syllable then a lower "bit".
  playCroak() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;

    const syllable = (start, dur, baseFreq, freqSlide, pulseHz, peakGain) => {
      const carrier = ctx.createOscillator();
      carrier.type = 'sawtooth';
      carrier.frequency.setValueAtTime(baseFreq, start);
      carrier.frequency.linearRampToValueAtTime(baseFreq + freqSlide, start + dur);

      const formant1 = ctx.createBiquadFilter();
      formant1.type = 'bandpass';
      formant1.frequency.value = 600;
      formant1.Q.value = 4;

      const formant2 = ctx.createBiquadFilter();
      formant2.type = 'bandpass';
      formant2.frequency.value = 1400;
      formant2.Q.value = 3;

      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.linearRampToValueAtTime(peakGain, start + dur * 0.25);
      envelope.gain.linearRampToValueAtTime(0.0001, start + dur);

      // Fast amplitude pulsing is what makes it buzz like a vocal sac
      // instead of ring like a smooth whistle.
      const pulseOsc = ctx.createOscillator();
      pulseOsc.type = 'square';
      pulseOsc.frequency.value = pulseHz;
      const pulseDepth = ctx.createGain();
      pulseDepth.gain.value = peakGain * 0.8;
      pulseOsc.connect(pulseDepth);
      pulseDepth.connect(envelope.gain);

      carrier.connect(formant1);
      formant1.connect(formant2);
      formant2.connect(envelope);
      envelope.connect(this.masterGain);

      carrier.start(start);
      carrier.stop(start + dur + 0.02);
      pulseOsc.start(start);
      pulseOsc.stop(start + dur + 0.02);
    };

    syllable(t0, 0.15, 140, 40, 75, 0.28); // "rib" - short, rising
    syllable(t0 + 0.16, 0.32, 115, -35, 65, 0.32); // "bit" - longer, falling, deeper
  },
};

// Phaser's input system queues native pointer events and dispatches them on
// the next game tick rather than inside the original browser event, which is
// one tick too late for iOS Safari's strict "must touch the AudioContext
// synchronously inside the real user gesture" unlock rule (Chrome is lenient
// about this; Safari often isn't). Listening directly on the document with a
// native handler guarantees Sfx.init()/resume() run in the actual gesture.
(function installNativeAudioUnlock() {
  const unlock = () => {
    Sfx.init();
    Sfx.resume();
    ['touchend', 'touchstart', 'mousedown', 'pointerdown', 'keydown'].forEach((type) =>
      document.removeEventListener(type, unlock)
    );
  };
  ['touchend', 'touchstart', 'mousedown', 'pointerdown', 'keydown'].forEach((type) =>
    document.addEventListener(type, unlock, { passive: true })
  );
})();

// ---- Shared drawing helpers (used by both scenes) ----

function createGameTextures(scene) {
  if (scene.textures.exists('frog_closed')) return; // already generated once

  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  const cx = FROG_CX, cy = FROG_CY;

  const drawFrogBody = () => {
    // Back legs (darker green, behind body)
    g.fillStyle(0x1b5e20, 1);
    g.fillEllipse(cx - 58, cy + 28, 34, 20);
    g.fillEllipse(cx + 58, cy + 28, 34, 20);

    // Body
    g.fillStyle(0x2e8b3d, 1);
    g.fillEllipse(cx, cy, 140, 108);
    g.lineStyle(3, 0x1b5e20, 1);
    g.strokeEllipse(cx, cy, 140, 108);

    // Front legs (lighter green, in front of body)
    g.fillStyle(0x388e3c, 1);
    g.fillEllipse(cx - 42, cy + 55, 28, 18);
    g.fillEllipse(cx + 42, cy + 55, 28, 18);

    // Belly patch
    g.fillStyle(0xa5d6a7, 1);
    g.fillEllipse(cx, cy + 20, 70, 42);

    // Eyes (white with black pupils), sitting on top of the head
    g.fillStyle(0xffffff, 1);
    g.fillCircle(cx - 34, cy - 48, 20);
    g.fillCircle(cx + 34, cy - 48, 20);
    g.lineStyle(2, 0x1b5e20, 1);
    g.strokeCircle(cx - 34, cy - 48, 20);
    g.strokeCircle(cx + 34, cy - 48, 20);
    g.fillStyle(0x000000, 1);
    g.fillCircle(cx - 34, cy - 45, 9);
    g.fillCircle(cx + 34, cy - 45, 9);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(cx - 37, cy - 49, 3);
    g.fillCircle(cx + 31, cy - 49, 3);
  };

  // Closed mouth: a simple curved line.
  drawFrogBody();
  g.lineStyle(4, 0x8d3b2f, 1);
  g.beginPath();
  g.arc(cx, cy - 8, 46, Phaser.Math.DegToRad(15), Phaser.Math.DegToRad(165), false);
  g.strokePath();
  g.generateTexture('frog_closed', FROG_TEX_W, FROG_TEX_H);
  g.clear();

  // Open mouth: a dark oval cavity the tongue launches from.
  drawFrogBody();
  g.fillStyle(0x5c1f1f, 1);
  g.fillEllipse(cx, cy + 2, 62, 30);
  g.lineStyle(3, 0x3b1010, 1);
  g.strokeEllipse(cx, cy + 2, 62, 30);
  g.fillStyle(0xffffff, 1);
  g.fillRect(cx - 26, cy - 10, 10, 8);
  g.fillRect(cx + 16, cy - 10, 10, 8);
  g.generateTexture('frog_open', FROG_TEX_W, FROG_TEX_H);
  g.clear();

  // Fly textures (a few colors).
  FLY_COLORS.forEach((color, i) => {
    const fw = 30, fh = 26;
    const fcx = fw / 2, fcy = fh / 2 + 2;

    g.fillStyle(0xffffff, 0.55);
    g.fillEllipse(fcx - 6, fcy - 8, 15, 9);
    g.fillEllipse(fcx + 6, fcy - 8, 15, 9);

    g.fillStyle(color, 1);
    g.fillEllipse(fcx, fcy, 17, 13);
    g.lineStyle(1.5, 0x000000, 0.35);
    g.strokeEllipse(fcx, fcy, 17, 13);

    g.fillStyle(0x000000, 0.85);
    g.fillCircle(fcx + 4, fcy - 2, 3);

    g.generateTexture('fly_' + i, fw, fh);
    g.clear();
  });

  // Generic particle texture.
  g.fillStyle(0xffffff, 1);
  g.fillCircle(4, 4, 4);
  g.generateTexture('particle', 8, 8);
  g.destroy();
}

function drawPondBackground(scene) {
  const bg = scene.add.graphics();
  bg.fillGradientStyle(0x6ec6ff, 0x6ec6ff, 0x01579b, 0x01579b, 1);
  bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  POND_LILY_PADS.forEach(([x, y, r]) => {
    bg.fillStyle(0x2e7d32, 0.25);
    bg.fillCircle(x, y, r);
    bg.fillStyle(0x1b5e20, 0.2);
    bg.fillCircle(x, y, r * 0.6);
  });
  bg.setDepth(-10);
  return bg;
}

// ---- Title / landing scene ----

class TitleScene extends Phaser.Scene {
  constructor() {
    super('TitleScene');
  }

  create() {
    createGameTextures(this);
    drawPondBackground(this);

    const cx = GAME_WIDTH / 2;

    this.add
      .text(cx, 140, 'FLY CATCHER', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '54px',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#00354d',
        strokeThickness: 8,
      })
      .setOrigin(0.5);

    this.add
      .text(cx, 195, 'A hungry frog needs your help!', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: '#e0f7ff',
      })
      .setOrigin(0.5);

    const previewFrog = this.add.image(cx, 420, 'frog_closed').setScale(1.15);
    this.tweens.add({
      targets: previewFrog,
      y: '+=10',
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    const instructions =
      "Tap anywhere on the pond to launch\nthe frog's tongue toward a fly.\nChain catches quickly for combo bonuses!";
    this.add
      .text(cx, 590, instructions, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px',
        color: '#ffffff',
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5);

    const playText = this.add
      .text(cx, 700, 'TAP TO PLAY', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '30px',
        fontStyle: 'bold',
        color: '#fff176',
        stroke: '#5d3f00',
        strokeThickness: 5,
      })
      .setOrigin(0.5);
    this.tweens.add({
      targets: playText,
      scale: { from: 1, to: 1.1 },
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // A single tap is the least any browser allows before audio can start
    // at all (mobile browsers block sound before any interaction, no way
    // around that) - so one tap unlocks audio, starts the calm tune, lets
    // it play through a full loop, then sends off with a croak and fades
    // into gameplay (tongue-sound only from there on).
    this.input.once('pointerdown', () => {
      Sfx.init();
      Sfx.resume();
      Sfx.startTune();

      this.time.delayedCall(3300, () => {
        Sfx.stopTune();
        Sfx.playCroak();
        this.cameras.main.fadeOut(300, 11, 61, 92);
        this.cameras.main.once('camerafadeoutcomplete', () => {
          this.scene.start('FlyCatcherScene');
        });
      });
    });
  }
}

// ---- Main gameplay scene ----

class FlyCatcherScene extends Phaser.Scene {
  constructor() {
    super('FlyCatcherScene');
  }

  init() {
    this.score = 0;
    this.combo = 0;
    this.lastCatchTime = 0;
    this.level = 1;
    this.elapsed = 0;
    this.spawnAccumulator = 0;
    this.tongues = [];
    this.activeTongueCount = 0;
    this.gameStarted = false;
  }

  preload() {}

  create() {
    createGameTextures(this); // no-op if the title scene already made these
    drawPondBackground(this);
    this.cameras.main.fadeIn(200, 11, 61, 92);

    // Frog sits near bottom center.
    this.frogX = GAME_WIDTH / 2;
    this.frogY = GAME_HEIGHT - 70;
    this.frog = this.add.image(this.frogX, this.frogY, 'frog_closed');

    // The tongue must launch from the mouth drawn on the frog texture, not
    // an arbitrary point above the sprite - derive it from the same local
    // coordinates used to draw that mouth.
    this.mouthX = this.frogX + (FROG_MOUTH_LOCAL_X - FROG_TEX_W / 2);
    this.mouthY = this.frogY + (FROG_MOUTH_LOCAL_Y - FROG_TEX_H / 2);

    // Flies physics group.
    this.flies = this.physics.add.group();

    // World bounds: bottom extended well past the screen so flies bounce off
    // top/left/right but simply fall away (and get removed) at the bottom.
    this.physics.world.setBounds(0, -40, GAME_WIDTH, GAME_HEIGHT + 400);

    // Particle emitter used for the catch burst.
    this.burstEmitter = this.add.particles('particle').createEmitter({
      x: 0,
      y: 0,
      speed: { min: 60, max: 180 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 400,
      quantity: 0,
      on: false,
    });

    this.buildUI();

    this.input.on('pointerdown', this.handlePointerDown, this);

    this.spawnFly();
  }

  buildUI() {
    const textStyle = {
      fontFamily: 'Arial, sans-serif',
      fontSize: '26px',
      color: '#ffffff',
      stroke: '#00354d',
      strokeThickness: 4,
    };

    this.scoreText = this.add.text(16, 14, 'Score: 0', textStyle).setDepth(20);
    this.comboText = this.add
      .text(16, 48, '', { ...textStyle, fontSize: '22px' })
      .setDepth(20);

    this.levelText = this.add
      .text(GAME_WIDTH - 16, 14, 'Level 1', textStyle)
      .setOrigin(1, 0)
      .setDepth(20);

    this.muteButton = this.add
      .text(GAME_WIDTH - 16, 52, Sfx.muted ? '🔇' : '🔊', {
        fontSize: '26px',
      })
      .setOrigin(1, 0)
      .setDepth(20);

    this.instructionText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'TAP A FLY TO CATCH IT!', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '32px',
        color: '#ffffff',
        stroke: '#00354d',
        strokeThickness: 5,
        align: 'center',
      })
      .setOrigin(0.5)
      .setAlpha(0.75)
      .setDepth(20);

    this.tweens.add({
      targets: this.instructionText,
      alpha: { from: 0.75, to: 0.35 },
      duration: 900,
      yoyo: true,
      repeat: -1,
    });
  }

  handlePointerDown(pointer) {
    const muteBounds = this.muteButton.getBounds();
    if (Phaser.Geom.Rectangle.Contains(muteBounds, pointer.x, pointer.y)) {
      const muted = Sfx.toggleMute();
      this.muteButton.setText(muted ? '🔇' : '🔊');
      return;
    }
    this.shootTongue(pointer);
  }

  // ---- Fly spawning & difficulty ----

  currentSpawnInterval() {
    const base = 1300;
    const byTime = this.elapsed * 8; // ms faster per second elapsed
    const byLevel = (this.level - 1) * 60;
    return Phaser.Math.Clamp(base - byTime - byLevel, 320, base);
  }

  spawnFly() {
    const x = Phaser.Math.Between(30, GAME_WIDTH - 30);
    const colorIndex = Phaser.Math.Between(0, FLY_COLORS.length - 1);
    const fly = this.flies.create(x, -20, 'fly_' + colorIndex);

    const speedBoost = (this.level - 1) * 4;
    fly.setVelocity(
      Phaser.Math.Between(-70, 70),
      Phaser.Math.Between(40 + speedBoost, 95 + speedBoost)
    );
    fly.setBounce(1, 1);
    fly.setCollideWorldBounds(true);
    fly.body.setAllowGravity(false);
    fly.setAngularVelocity(Phaser.Math.Between(-40, 40));
  }

  // ---- Tongue shooting ----
  // The tongue is aimed at the tap point: it extends in a straight line from
  // the frog's mouth toward the target, stopping (and retracting) as soon as
  // it either reaches a fly or its max length, then snaps back to the mouth.

  shootTongue(pointer) {
    Sfx.resume(); // extra nudge on a real gesture, in case iOS left it suspended

    if (!this.gameStarted) {
      this.gameStarted = true;
      this.tweens.add({
        targets: this.instructionText,
        alpha: 0,
        duration: 300,
        onComplete: () => this.instructionText.setVisible(false),
      });
    }

    const originX = this.mouthX;
    const originY = this.mouthY;

    // Always aim at least somewhat upward, even if the tap lands low on screen.
    const targetX = pointer.x;
    const targetY = Math.min(pointer.y, originY - 20);

    const dx = targetX - originX;
    const dy = targetY - originY;
    const rawDist = Math.hypot(dx, dy) || 1;
    const maxLength = Phaser.Math.Clamp(rawDist, 40, 740);

    const tongue = {
      originX,
      originY,
      dirX: dx / rawDist,
      dirY: dy / rawDist,
      maxLength,
      length: 0,
      state: 'extending',
      graphics: this.add.graphics().setDepth(14),
    };
    this.tongues.push(tongue);
    this.activeTongueCount++;
    this.frog.setTexture('frog_open');
    Sfx.playTongueShoot();

    // Small squash animation on the frog for feedback.
    this.tweens.add({
      targets: this.frog,
      scaleY: 0.9,
      scaleX: 1.06,
      duration: 80,
      yoyo: true,
    });
  }

  updateTongues(delta) {
    const EXTEND_SPEED = 1300; // px/sec
    const RETRACT_SPEED = 1700; // px/sec
    const CATCH_RADIUS = 22;

    for (let i = this.tongues.length - 1; i >= 0; i--) {
      const t = this.tongues[i];

      if (t.state === 'extending') {
        t.length = Math.min(t.length + (EXTEND_SPEED * delta) / 1000, t.maxLength);

        const tipX = t.originX + t.dirX * t.length;
        const tipY = t.originY + t.dirY * t.length;

        let caughtFly = null;
        this.flies.children.each((fly) => {
          if (!caughtFly && Phaser.Math.Distance.Between(tipX, tipY, fly.x, fly.y) < CATCH_RADIUS) {
            caughtFly = fly;
          }
        });

        if (caughtFly) {
          this.catchFly(caughtFly, tipX, tipY);
          t.state = 'retracting';
        } else if (t.length >= t.maxLength) {
          t.state = 'retracting';
        }
      } else {
        t.length = Math.max(t.length - (RETRACT_SPEED * delta) / 1000, 0);
      }

      const tipX = t.originX + t.dirX * t.length;
      const tipY = t.originY + t.dirY * t.length;

      // Draw the tongue as a stretchy pink capsule with a highlight stripe.
      t.graphics.clear();
      if (t.length > 1) {
        t.graphics.lineStyle(14, 0xff6f9c, 1);
        t.graphics.beginPath();
        t.graphics.moveTo(t.originX, t.originY);
        t.graphics.lineTo(tipX, tipY);
        t.graphics.strokePath();
        t.graphics.fillStyle(0xff6f9c, 1);
        t.graphics.fillCircle(tipX, tipY, 9);
        t.graphics.lineStyle(4, 0xffc1d9, 0.85);
        t.graphics.beginPath();
        t.graphics.moveTo(t.originX, t.originY);
        t.graphics.lineTo(tipX, tipY);
        t.graphics.strokePath();
      }

      if (t.state === 'retracting' && t.length <= 0) {
        t.graphics.destroy();
        this.tongues.splice(i, 1);
        this.activeTongueCount = Math.max(0, this.activeTongueCount - 1);
        if (this.activeTongueCount === 0) {
          this.frog.setTexture('frog_closed');
        }
      }
    }
  }

  // ---- Catching flies ----

  catchFly(fly, x, y) {
    const now = this.time.now;

    if (this.lastCatchTime > 0 && now - this.lastCatchTime <= 3000) {
      this.combo += 1;
    } else {
      this.combo = 1;
    }
    this.lastCatchTime = now;

    const basePoints = 10;
    const points = basePoints * this.combo;
    this.score += points;

    this.updateScoreUI();
    this.updateComboUI();
    this.updateLevelUI();

    this.spawnPointsPopup(x, y, points);

    this.burstEmitter.setPosition(x, y);
    this.burstEmitter.explode(14);

    fly.destroy();
  }

  spawnPointsPopup(x, y, points) {
    const popup = this.add
      .text(x, y, '+' + points, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '22px',
        color: '#fff176',
        stroke: '#5d3f00',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(25);

    this.tweens.add({
      targets: popup,
      y: y - 60,
      alpha: 0,
      duration: 700,
      ease: 'Cubic.easeOut',
      onComplete: () => popup.destroy(),
    });
  }

  updateScoreUI() {
    this.scoreText.setText('Score: ' + this.score);
  }

  updateComboUI() {
    if (this.combo > 1) {
      this.comboText.setText('Combo x' + this.combo);
      const hot = this.combo >= 5;
      this.comboText.setColor(hot ? '#ff5252' : '#ffee58');
      if (hot) {
        this.tweens.add({
          targets: this.comboText,
          scale: { from: 1.3, to: 1 },
          duration: 200,
          ease: 'Back.easeOut',
        });
      }
    } else {
      this.comboText.setText('');
    }
  }

  updateLevelUI() {
    const newLevel = 1 + Math.floor(this.score / 500);
    if (newLevel !== this.level) {
      this.level = newLevel;
      this.levelText.setText('Level ' + this.level);
      this.tweens.add({
        targets: this.levelText,
        scale: { from: 1.4, to: 1 },
        duration: 300,
        ease: 'Back.easeOut',
      });
    }
  }

  // ---- Main loop ----

  update(time, delta) {
    this.elapsed += delta / 1000;

    // Spawn flies with increasing frequency.
    this.spawnAccumulator += delta;
    if (this.spawnAccumulator >= this.currentSpawnInterval()) {
      this.spawnAccumulator = 0;
      this.spawnFly();
    }

    // Remove flies that fell off the bottom or drifted far off the sides.
    this.flies.children.each((fly) => {
      if (fly.y > GAME_HEIGHT + 30 || fly.x < -60 || fly.x > GAME_WIDTH + 60) {
        fly.destroy();
      }
    });

    this.updateTongues(delta);

    // Reset combo if too much time has passed since the last catch.
    if (
      this.combo > 0 &&
      this.lastCatchTime > 0 &&
      time - this.lastCatchTime > 3000
    ) {
      this.combo = 0;
      this.updateComboUI();
    }
  }
}

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#0b3d5c',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false,
    },
  },
  scene: [TitleScene, FlyCatcherScene],
};

window.Sfx = Sfx; // exposed for troubleshooting from the browser console

window.addEventListener('load', () => {
  new Phaser.Game(config);
});
