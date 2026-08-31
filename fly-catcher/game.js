// Fly Catcher - Phaser 3 mobile web game
// All visuals are drawn procedurally with the Phaser Graphics API.

const GAME_WIDTH = 480;
const GAME_HEIGHT = 800;

const FLY_COLORS = [0xd32f2f, 0xffb300, 0x8e24aa, 0x43a047];

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
    this.gameStarted = false;
  }

  preload() {}

  create() {
    this.createTextures();
    this.drawBackground();

    // Frog sits near bottom center.
    this.frogX = GAME_WIDTH / 2;
    this.frogY = GAME_HEIGHT - 70;
    this.frog = this.add.image(this.frogX, this.frogY, 'frog');
    this.mouthY = this.frogY - 58;

    // Flies physics group.
    this.flies = this.physics.add.group();

    // Tongue tips physics group (invisible bodies used for overlap detection).
    this.tongueTips = this.physics.add.group();

    // World bounds: bottom extended well past the screen so flies bounce off
    // top/left/right but simply fall away (and get removed) at the bottom.
    this.physics.world.setBounds(0, -40, GAME_WIDTH, GAME_HEIGHT + 400);

    this.physics.add.overlap(
      this.tongueTips,
      this.flies,
      this.onTongueHitFly,
      undefined,
      this
    );

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

    this.input.on('pointerdown', this.shootTongue, this);

    this.spawnFly();
  }

  createTextures() {
    // --- Frog texture ---
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    const w = 170, h = 150;
    const cx = w / 2, cy = 95;

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

    // Mouth
    g.lineStyle(4, 0x8d3b2f, 1);
    g.beginPath();
    g.arc(cx, cy - 8, 46, Phaser.Math.DegToRad(15), Phaser.Math.DegToRad(165), false);
    g.strokePath();

    g.generateTexture('frog', w, h);
    g.clear();

    // --- Fly textures (a few colors) ---
    FLY_COLORS.forEach((color, i) => {
      const fw = 30, fh = 26;
      const fcx = fw / 2, fcy = fh / 2 + 2;

      // Wings (behind body)
      g.fillStyle(0xffffff, 0.55);
      g.fillEllipse(fcx - 6, fcy - 8, 15, 9);
      g.fillEllipse(fcx + 6, fcy - 8, 15, 9);

      // Body
      g.fillStyle(color, 1);
      g.fillEllipse(fcx, fcy, 17, 13);
      g.lineStyle(1.5, 0x000000, 0.35);
      g.strokeEllipse(fcx, fcy, 17, 13);

      // Eye
      g.fillStyle(0x000000, 0.85);
      g.fillCircle(fcx + 4, fcy - 2, 3);

      g.generateTexture('fly_' + i, fw, fh);
      g.clear();
    });

    // --- Tongue segment texture (pink circle) ---
    g.fillStyle(0xff6f9c, 1);
    g.fillCircle(8, 8, 8);
    g.lineStyle(1.5, 0xd6497a, 1);
    g.strokeCircle(8, 8, 8);
    g.generateTexture('tongueSegment', 16, 16);
    g.clear();

    // --- Generic particle texture ---
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture('particle', 8, 8);
    g.destroy();
  }

  drawBackground() {
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x6ec6ff, 0x6ec6ff, 0x01579b, 0x01579b, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Semi-transparent lily pads scattered around the pond.
    const pads = [
      [70, 140, 55], [370, 90, 40], [200, 230, 65],
      [60, 340, 45], [400, 300, 50], [260, 450, 60],
      [120, 560, 42], [380, 520, 38],
    ];
    pads.forEach(([x, y, r]) => {
      bg.fillStyle(0x2e7d32, 0.25);
      bg.fillCircle(x, y, r);
      bg.fillStyle(0x1b5e20, 0.2);
      bg.fillCircle(x, y, r * 0.6);
    });
    bg.setDepth(-10);
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

    this.instructionText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'TAP TO CATCH FLIES!', {
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

  shootTongue() {
    if (!this.gameStarted) {
      this.gameStarted = true;
      this.tweens.add({
        targets: this.instructionText,
        alpha: 0,
        duration: 300,
        onComplete: () => this.instructionText.setVisible(false),
      });
    }

    const startY = this.mouthY;
    const tip = this.tongueTips.create(this.frogX, startY, 'tongueSegment');
    tip.body.setAllowGravity(false);
    tip.setDepth(15);
    tip.setVelocityY(-820);

    const graphics = this.add.graphics().setDepth(14);

    const tongue = {
      sprite: tip,
      graphics,
      startY,
      state: 'extending',
      alpha: 1,
    };
    tip.tongueRef = tongue;
    this.tongues.push(tongue);

    // Small squash animation on the frog for feedback.
    this.tweens.add({
      targets: this.frog,
      scaleY: 0.9,
      scaleX: 1.06,
      duration: 80,
      yoyo: true,
    });
  }

  onTongueHitFly(tip, fly) {
    if (tip.tongueRef.state !== 'extending') return;
    this.catchFly(fly, tip.x, tip.y);
    tip.tongueRef.state = 'retracting';
    tip.body.enable = false;
  }

  updateTongues() {
    const topLimit = 20;
    for (let i = this.tongues.length - 1; i >= 0; i--) {
      const t = this.tongues[i];

      if (t.state === 'extending' && t.sprite.y <= topLimit) {
        t.state = 'retracting';
        t.sprite.body.enable = false;
      }

      if (t.state === 'retracting') {
        t.alpha *= 0.82;
        t.sprite.setAlpha(t.alpha);
        t.graphics.setAlpha(t.alpha);
        if (t.alpha < 0.05) {
          t.sprite.destroy();
          t.graphics.destroy();
          this.tongues.splice(i, 1);
          continue;
        }
      }

      // Redraw the chain of pink circles between the frog mouth and the tip.
      t.graphics.clear();
      const totalDist = t.startY - t.sprite.y;
      const step = 14;
      const segments = Math.max(1, Math.floor(totalDist / step));
      for (let s = 0; s <= segments; s++) {
        const y = t.startY - s * step;
        const fade = segments === 0 ? 1 : s / segments; // more opaque near the tip
        const alpha = Phaser.Math.Clamp(0.25 + fade * 0.75, 0, 1);
        const radius = 6 + fade * 3;
        t.graphics.fillStyle(0xff6f9c, alpha);
        t.graphics.fillCircle(this.frogX, y, radius);
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

    this.updateTongues();

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
  scene: FlyCatcherScene,
};

window.addEventListener('load', () => {
  new Phaser.Game(config);
});
