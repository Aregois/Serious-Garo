/* Desert Arena FPS (Serious Sam-inspired)
   Single-file JS engine. No external assets. */

(() => {
  // ---------- Canvas / Resize ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener("resize", resize);
  resize();

  // ---------- UI Elements ----------
  const ui = {
    startScreen: document.getElementById("centerMsg"),
    gameOver: document.getElementById("gameOver"),
    victory: document.getElementById("victory"),
    damage: document.getElementById("damage"),
    hp: document.getElementById("hp"),
    weapon: document.getElementById("weapon"),
    ammo: document.getElementById("ammo"),
    kills: document.getElementById("kills"),
    wave: document.getElementById("wave"),
    waveMax: document.getElementById("waveMax"),
    left: document.getElementById("left"),
    startBtn: document.getElementById("startBtn"),
    restartBtn: document.getElementById("restartBtn"),
    restartBtn2: document.getElementById("restartBtn2"),
  };

  // ---------- Utilities ----------
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => (a + Math.random() * (b - a + 1)) | 0;

  function dist2(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  }
  function norm(x, y) {
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  }

  // ---------- Sound System (Web Audio API) ----------
  const AudioSys = (() => {
    let ac = null;
    let windNode = null;

    function ensure() {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === "suspended") ac.resume();
    }

    function beep({ freq = 440, dur = 0.08, type = "square", gain = 0.08, slide = 0 } = {}) {
      ensure();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = gain;
      if (slide) o.frequency.linearRampToValueAtTime(freq + slide, ac.currentTime + dur);

      o.connect(g).connect(ac.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.stop(ac.currentTime + dur);
    }

    function noise(dur = 0.12, gain = 0.06, lowpass = 1200) {
      ensure();
      const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);

      const src = ac.createBufferSource();
      src.buffer = buf;

      const filt = ac.createBiquadFilter();
      filt.type = "lowpass"; filt.frequency.value = lowpass;

      const g = ac.createGain();
      g.gain.value = gain;

      src.connect(filt).connect(g).connect(ac.destination);
      src.start();
      src.stop(ac.currentTime + dur);
    }

    function pistol() { beep({ freq: 620, dur: 0.05, type: "square", gain: 0.08, slide: -200 }); noise(0.04, 0.04, 1800); }
    function shotgun() { beep({ freq: 180, dur: 0.09, type: "sawtooth", gain: 0.12, slide: -80 }); noise(0.08, 0.10, 800); }
    function minigunShot() { beep({ freq: 420, dur: 0.03, type: "square", gain: 0.05, slide: -120 }); }
    function enemyDeath() { beep({ freq: 260, dur: 0.12, type: "triangle", gain: 0.09, slide: -140 }); noise(0.07, 0.06, 900); }
    function playerHit() { beep({ freq: 90, dur: 0.09, type: "square", gain: 0.12, slide: -30 }); }
    function screamLoopStart() {
      ensure();
      if (!ac) return null;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sawtooth";
      o.frequency.value = 520;
      g.gain.value = 0.02;
      o.connect(g).connect(ac.destination);
      o.start();
      return { o, g };
    }
    function screamLoopStop(node) {
      if (!node || !ac) return;
      node.g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.1);
      node.o.stop(ac.currentTime + 0.12);
    }

    function windStart() {
      ensure();
      if (windNode) return;
      // White noise buffer loop + lowpass filter.
      const dur = 1.2;
      const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);

      const src = ac.createBufferSource();
      src.buffer = buf;
      src.loop = true;

      const filt = ac.createBiquadFilter();
      filt.type = "lowpass"; filt.frequency.value = 600;

      const g = ac.createGain();
      g.gain.value = 0.03;

      src.connect(filt).connect(g).connect(ac.destination);
      src.start();
      windNode = { src, filt, g };
    }
    function windStop() {
      if (!windNode || !ac) return;
      windNode.g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.3);
      windNode.src.stop(ac.currentTime + 0.35);
      windNode = null;
    }

    return {
      ensure, pistol, shotgun, minigunShot, enemyDeath, playerHit,
      screamLoopStart, screamLoopStop, windStart, windStop
    };
  })();

  // ---------- Input ----------
  const input = {
    keys: new Set(),
    mouseX: 0, mouseY: 0,
    aimAngle: 0,
    firing: false,
    locked: false
  };

  addEventListener("keydown", (e) => input.keys.add(e.code));
  addEventListener("keyup", (e) => input.keys.delete(e.code));

  canvas.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === canvas) {
      input.mouseX += e.movementX;
      input.mouseY += e.movementY;
    } else {
      const r = canvas.getBoundingClientRect();
      input.mouseX = e.clientX - r.left;
      input.mouseY = e.clientY - r.top;
    }
  });

  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) input.firing = true;
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    AudioSys.ensure();
  });
  addEventListener("mouseup", (e) => { if (e.button === 0) input.firing = false; });

  document.addEventListener("pointerlockchange", () => {
    input.locked = (document.pointerLockElement === canvas);
  });

  // ---------- World / Camera ----------
  const world = {
    w: 2200, h: 2200,
    obstacles: []
  };

  function buildLevel() {
    world.obstacles.length = 0;
    // Pillars
    world.obstacles.push({ x: 600, y: 600, w: 140, h: 220, type: "pillar" });
    world.obstacles.push({ x: 1500, y: 500, w: 160, h: 240, type: "pillar" });
    world.obstacles.push({ x: 1000, y: 1500, w: 180, h: 260, type: "pillar" });
    // Broken wall
    world.obstacles.push({ x: 900, y: 980, w: 420, h: 80, type: "wall" });
  }

  // ---------- Entities ----------
  class Player {
    constructor() {
      this.x = world.w / 2;
      this.y = world.h / 2;
      this.r = 18;
      this.hp = 100;
      this.kills = 0;
      this.alive = true;
      this.speed = 220;
      this.weaponIndex = 0;
      this.weapons = [new Pistol(this), new Shotgun(this), new Minigun(this)];
    }
    get weapon() { return this.weapons[this.weaponIndex]; }

    update(dt) {
      // Switch weapons
      if (input.keys.has("Digit1")) this.weaponIndex = 0;
      if (input.keys.has("Digit2")) this.weaponIndex = 1;
      if (input.keys.has("Digit3")) this.weaponIndex = 2;

      // Movement
      let vx = 0, vy = 0;
      if (input.keys.has("KeyW")) vy -= 1;
      if (input.keys.has("KeyS")) vy += 1;
      if (input.keys.has("KeyA")) vx -= 1;
      if (input.keys.has("KeyD")) vx += 1;
      if (vx || vy) {
        const [nx, ny] = norm(vx, vy);
        this.x += nx * this.speed * dt;
        this.y += ny * this.speed * dt;
      }
      this.x = clamp(this.x, this.r, world.w - this.r);
      this.y = clamp(this.y, this.r, world.h - this.r);

      // Aim angle relative to screen center
      const cx = canvas.width / (window.devicePixelRatio || 1) / 2;
      const cy = canvas.height / (window.devicePixelRatio || 1) / 2;
      const mx = input.locked ? cx + input.mouseX : input.mouseX;
      const my = input.locked ? cy + input.mouseY : input.mouseY;
      this.aimX = mx; this.aimY = my;
      input.aimAngle = Math.atan2(my - cy, mx - cx);

      // Shoot
      this.weapon.update(dt);
      if (input.firing) this.weapon.tryFire();

      // Update HUD
      ui.weapon.textContent = this.weapon.name;
      ui.ammo.textContent = this.weapon.ammoText;
      ui.hp.textContent = Math.max(0, this.hp | 0);
      ui.kills.textContent = this.kills;
    }

    takeDamage(dmg) {
      if (!this.alive) return;
      this.hp -= dmg;
      AudioSys.playerHit();
      flashDamage();

      if (this.hp <= 0) {
        this.hp = 0;
        this.alive = false;
        game.state = "gameover";
        AudioSys.windStop();
        ui.gameOver.style.display = "grid";
      }
    }

    draw(cam) {
      const sx = this.x - cam.x, sy = this.y - cam.y;

      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.ellipse(sx, sy + 10, this.r * 1.1, this.r * 0.6, 0, 0, TAU); ctx.fill();

      // Body
      ctx.fillStyle = "#2fa8ff";
      ctx.beginPath(); ctx.arc(sx, sy, this.r, 0, TAU); ctx.fill();

      // Facing line
      ctx.strokeStyle = "#073b68";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + Math.cos(input.aimAngle) * this.r * 1.6, sy + Math.sin(input.aimAngle) * this.r * 1.6);
      ctx.stroke();
    }
  }

  class Bullet {
    constructor(x, y, vx, vy, dmg, owner) {
      this.x = x; this.y = y;
      this.vx = vx; this.vy = vy;
      this.dmg = dmg;
      this.owner = owner;
      this.life = 1.4;
      this.r = 3;
    }
    update(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.life -= dt;
      if (this.x < 0 || this.y < 0 || this.x > world.w || this.y > world.h) this.life = 0;
    }
    draw(cam) {
      const sx = this.x - cam.x, sy = this.y - cam.y;
      ctx.fillStyle = "#fff4c7";
      ctx.beginPath(); ctx.arc(sx, sy, this.r, 0, TAU); ctx.fill();
    }
  }

  // ---------- Weapons ----------
  class WeaponBase {
    constructor(player) {
      this.player = player;
      this.cooldown = 0;
      this.name = "Weapon";
      this.fireRate = 2; // shots per sec
      this.damage = 10;
      this.spread = 0;
    }
    get ammoText() { return "∞"; }
    update(dt) {
      this.cooldown = Math.max(0, this.cooldown - dt);
    }
    tryFire() {
      if (this.cooldown > 0) return;
      this.cooldown = 1 / this.fireRate;
      this.fire();
    }
    fire() {}
    muzzleFX(angle) {
      for (let i = 0; i < 6; i++) {
        particles.push(new Particle(
          this.player.x + Math.cos(angle) * 26,
          this.player.y + Math.sin(angle) * 26,
          Math.cos(angle + rand(-0.25, 0.25)) * rand(60, 140),
          Math.sin(angle + rand(-0.25, 0.25)) * rand(60, 140),
          rand(0.05, 0.12),
          "muzzle"
        ));
      }
    }
  }

  class Pistol extends WeaponBase {
    constructor(p) {
      super(p);
      this.name = "Pistol";
      this.fireRate = 2.2;
      this.damage = 14;
      this.spread = 0.03;
    }
    fire() {
      const a = input.aimAngle + rand(-this.spread, this.spread);
      const speed = 700;
      bullets.push(new Bullet(
        this.player.x + Math.cos(a) * 22,
        this.player.y + Math.sin(a) * 22,
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        this.damage, this.player
      ));
      AudioSys.pistol();
      this.muzzleFX(a);
    }
  }

  class Shotgun extends WeaponBase {
    constructor(p) {
      super(p);
      this.name = "Shotgun";
      this.fireRate = 1.1;
      this.damage = 9;  // per pellet
      this.spread = 0.35;
      this.pellets = 8;
    }
    fire() {
      const base = input.aimAngle;
      const speed = 620;
      for (let i = 0; i < this.pellets; i++) {
        const a = base + rand(-this.spread, this.spread);
        bullets.push(new Bullet(
          this.player.x + Math.cos(a) * 22,
          this.player.y + Math.sin(a) * 22,
          Math.cos(a) * speed,
          Math.sin(a) * speed,
          this.damage, this.player
        ));
      }
      AudioSys.shotgun();
      this.muzzleFX(base);
    }
  }

  class Minigun extends WeaponBase {
    constructor(p) {
      super(p);
      this.name = "Minigun";
      this.fireRate = 14;
      this.damage = 4;
      this.spread = 0.06;
      this.rot = 0;
    }
    update(dt) {
      super.update(dt);
      if (input.firing) this.rot += dt * 25;
    }
    fire() {
      const a = input.aimAngle + rand(-this.spread, this.spread);
      const speed = 900;
      bullets.push(new Bullet(
        this.player.x + Math.cos(a) * 24,
        this.player.y + Math.sin(a) * 24,
        Math.cos(a) * speed,
        Math.sin(a) * speed,
        this.damage, this.player
      ));
      AudioSys.minigunShot();
      this.muzzleFX(a);
    }
  }

  // ---------- Enemies ----------
  class EnemyBase {
    constructor(x, y) {
      this.x = x; this.y = y;
      this.vx = 0; this.vy = 0;
      this.hp = 20;
      this.r = 18;
      this.speed = 100;
      this.damage = 5;
      this.type = "enemy";
      this.dead = false;
      this.hitFlash = 0;
      this.score = 1;
    }
    takeDamage(dmg) {
      this.hp -= dmg;
      this.hitFlash = 0.08;
      for (let i = 0; i < 10; i++) {
        particles.push(new Particle(
          this.x, this.y,
          rand(-140, 140), rand(-140, 140),
          rand(0.2, 0.5),
          "blood"
        ));
      }
      if (this.hp <= 0) this.die();
    }
    die() {
      if (this.dead) return;
      this.dead = true;
      player.kills += this.score;
      AudioSys.enemyDeath();
    }
    update(dt) {
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      // dust trail
      if (Math.random() < 0.35) {
        particles.push(new Particle(this.x, this.y, rand(-20,20), rand(-20,20), rand(0.3,0.6), "dust"));
      }
      this.x = clamp(this.x, this.r, world.w - this.r);
      this.y = clamp(this.y, this.r, world.h - this.r);
    }
    draw(cam) {}
  }

  // Kamikaze Runner
  class Kamikaze extends EnemyBase {
    constructor(x, y) {
      super(x, y);
      this.type = "kamikaze";
      this.hp = 18;
      this.r = 16;
      this.speed = 170;
      this.damage = 28;
      this.score = 1;
      this.scream = AudioSys.screamLoopStart();
    }
    update(dt) {
      const dx = player.x - this.x, dy = player.y - this.y;
      const [nx, ny] = norm(dx, dy);
      this.vx = nx * this.speed;
      this.vy = ny * this.speed;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      super.update(dt);

      // contact explode
      if (dist2(this.x, this.y, player.x, player.y) < (this.r + player.r) ** 2) {
        player.takeDamage(this.damage);
        this.die();
      }
      if (this.dead) AudioSys.screamLoopStop(this.scream);
    }
    die() {
      if (this.dead) return;
      super.die();
      // explosion particles
      for (let i = 0; i < 24; i++) {
        particles.push(new Particle(
          this.x, this.y,
          rand(-240, 240), rand(-240, 240),
          rand(0.25, 0.6),
          "dust"
        ));
      }
      AudioSys.screamLoopStop(this.scream);
    }
    draw(cam) {
      const sx = this.x - cam.x, sy = this.y - cam.y;
      // body
      ctx.fillStyle = this.hitFlash ? "#fff" : "#d53b2a";
      ctx.beginPath(); ctx.arc(sx, sy, this.r, 0, TAU); ctx.fill();
      // bombs
      ctx.fillStyle = "#222";
      ctx.beginPath(); ctx.arc(sx - 12, sy + 2, 6, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 12, sy + 2, 6, 0, TAU); ctx.fill();
      // legs (headless humanoid vibe)
      ctx.strokeStyle = "#5c120b"; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx - 5, sy + 10); ctx.lineTo(sx - 10, sy + 22);
      ctx.moveTo(sx + 5, sy + 10); ctx.lineTo(sx + 10, sy + 22);
      ctx.stroke();
    }
  }

  // Gnaar Beast zig-zag
  class Gnaar extends EnemyBase {
    constructor(x, y) {
      super(x, y);
      this.type = "gnaar";
      this.hp = 40;
      this.r = 22;
      this.speed = 120;
      this.damage = 10;
      this.score = 2;
      this.t = rand(0, 10);
      this.zigAmp = rand(0.9, 1.4);
    }
    update(dt) {
      this.t += dt * 6;
      const dx = player.x - this.x, dy = player.y - this.y;
      const [nx, ny] = norm(dx, dy);

      // perpendicular zig-zag using sine
      const px = -ny, py = nx;
      const zig = Math.sin(this.t) * 0.7 * this.zigAmp;

      this.vx = nx * this.speed + px * this.speed * zig;
      this.vy = ny * this.speed + py * this.speed * zig;

      this.x += this.vx * dt;
      this.y += this.vy * dt;
      super.update(dt);

      if (dist2(this.x, this.y, player.x, player.y) < (this.r + player.r) ** 2) {
        player.takeDamage(this.damage * dt * 6); // sustained melee
      }
    }
    draw(cam) {
      const sx = this.x - cam.x, sy = this.y - cam.y;
      ctx.fillStyle = this.hitFlash ? "#fff" : "#7bd14a";
      ctx.beginPath(); ctx.arc(sx, sy, this.r, 0, TAU); ctx.fill();
      // mouth
      ctx.fillStyle = "#0b2a0b";
      ctx.beginPath(); ctx.arc(sx, sy + 4, this.r * 0.6, 0, TAU); ctx.fill();
      // teeth
      ctx.fillStyle = "#e9f5e9";
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(sx + i * 6, sy + 2);
        ctx.lineTo(sx + i * 6 + 3, sy + 9);
        ctx.lineTo(sx + i * 6 - 3, sy + 9);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // Werebull: slow then burst charge
  class Werebull extends EnemyBase {
    constructor(x, y) {
      super(x, y);
      this.type = "werebull";
      this.hp = 90;
      this.r = 26;
      this.speed = 70;
      this.chargeSpeed = 260;
      this.damage = 18;
      this.score = 4;
      this.phase = "walk";
      this.phaseT = rand(0.5, 1.5);
      this.accel = 0;
    }
    update(dt) {
      this.phaseT -= dt;
      if (this.phaseT <= 0) {
        if (this.phase === "walk") {
          this.phase = "charge";
          this.phaseT = rand(0.6, 0.9);
        } else {
          this.phase = "cool";
          this.phaseT = rand(0.7, 1.2);
        }
        if (this.phase === "cool") this.speed = 90;
        if (this.phase === "walk") this.speed = 70;
        if (this.phase === "charge") this.speed = this.chargeSpeed;
      }

      const dx = player.x - this.x, dy = player.y - this.y;
      const [nx, ny] = norm(dx, dy);

      // acceleration feel: ramp during charge
      if (this.phase === "charge") this.accel = Math.min(1, this.accel + dt * 2.6);
      else this.accel = Math.max(0, this.accel - dt * 2.0);
      const sp = this.speed * (0.4 + 0.6 * this.accel);

      this.vx = nx * sp;
      this.vy = ny * sp;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      super.update(dt);

      if (dist2(this.x, this.y, player.x, player.y) < (this.r + player.r) ** 2) {
        player.takeDamage(this.damage * dt * (this.phase === "charge" ? 9 : 4));
      }
    }
    draw(cam) {
      const sx = this.x - cam.x, sy = this.y - cam.y;
      ctx.fillStyle = this.hitFlash ? "#fff" : "#8b5a2b";
      // bull triangle body
      ctx.beginPath();
      ctx.moveTo(sx, sy - this.r);
      ctx.lineTo(sx - this.r, sy + this.r);
      ctx.lineTo(sx + this.r, sy + this.r);
      ctx.closePath();
      ctx.fill();
      // horns
      ctx.strokeStyle = "#f1e2c2"; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy - 6); ctx.lineTo(sx - 24, sy - 14);
      ctx.moveTo(sx + 10, sy - 6); ctx.lineTo(sx + 24, sy - 14);
      ctx.stroke();
    }
  }

  // ---------- Particles ----------
  class Particle {
    constructor(x, y, vx, vy, life, kind) {
      this.x = x; this.y = y;
      this.vx = vx; this.vy = vy;
      this.life = life;
      this.kind = kind;
      this.size = kind === "blood" ? rand(2, 4) : rand(1, 3);
    }
    update(dt) {
      this.life -= dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.kind === "blood") {
        this.vx *= 0.92; this.vy *= 0.92;
      } else {
        this.vx *= 0.88; this.vy *= 0.88;
      }
    }
    draw(cam) {
      const sx = this.x - cam.x, sy = this.y - cam.y;
      if (this.kind === "blood") ctx.fillStyle = "rgba(180,0,0,0.9)";
      if (this.kind === "dust") ctx.fillStyle = "rgba(120,90,40,0.7)";
      if (this.kind === "muzzle") ctx.fillStyle = "rgba(255,220,80,0.9)";
      ctx.beginPath(); ctx.arc(sx, sy, this.size, 0, TAU); ctx.fill();
    }
  }

  // ---------- Spawn / Waves ----------
  const Spawn = {
    wave: 1,
    maxWaves: 4,
    nextWaveIn: 2.0,
    aliveThisWave: 0,
    difficulty: 1,

    start() {
      this.wave = 1;
      this.maxWaves = randInt(3, 5);
      ui.waveMax.textContent = this.maxWaves;
      this.nextWaveIn = 2.0;
      this.aliveThisWave = 0;
      this.difficulty = 1;
    },

    update(dt) {
      if (game.state !== "playing") return;

      // If wave cleared, schedule next
      if (this.aliveThisWave <= 0 && enemies.length === 0) {
        this.nextWaveIn -= dt;
        if (this.nextWaveIn <= 0) {
          if (this.wave > this.maxWaves) {
            game.state = "victory";
            AudioSys.windStop();
            ui.victory.style.display = "grid";
            return;
          }
          this.spawnWave();
        }
      }
      ui.wave.textContent = Math.min(this.wave, this.maxWaves);
      ui.left.textContent = enemies.length;
    },

    spawnWave() {
      const baseCount = 6 + this.wave * 3;
      const count = Math.floor(baseCount * this.difficulty);
      this.aliveThisWave = count;
      this.nextWaveIn = rand(5, 9);
      this.difficulty += 0.18;
      this.wave++;

      for (let i = 0; i < count; i++) {
        const typeRoll = Math.random();
        let type = "kamikaze";
        if (typeRoll > 0.55) type = "gnaar";
        if (typeRoll > 0.83) type = "werebull";

        spawnEnemy(type);
      }
    }
  };

  function spawnEnemy(type) {
    // Spawn outside camera range
    const angle = rand(0, TAU);
    const dist = rand(380, 560);
    const x = clamp(player.x + Math.cos(angle) * dist, 40, world.w - 40);
    const y = clamp(player.y + Math.sin(angle) * dist, 40, world.h - 40);

    let e = null;
    if (type === "kamikaze") e = new Kamikaze(x, y);
    if (type === "gnaar") e = new Gnaar(x, y);
    if (type === "werebull") e = new Werebull(x, y);
    enemies.push(e);
  }

  // ---------- Background Texture ----------
  const sandDots = [];
  function makeSand() {
    sandDots.length = 0;
    for (let i = 0; i < 1500; i++) {
      sandDots.push({
        x: rand(0, world.w),
        y: rand(0, world.h),
        r: rand(0.8, 2.2),
        a: rand(0.05, 0.16)
      });
    }
  }

  // ---------- Game State ----------
  let player, enemies, bullets, particles;
  const cam = { x: 0, y: 0 };
  const game = { state: "start" };

  function resetGame() {
    player = new Player();
    enemies = [];
    bullets = [];
    particles = [];
    buildLevel();
    makeSand();
    Spawn.start();
    game.state = "playing";
    ui.gameOver.style.display = "none";
    ui.victory.style.display = "none";
    ui.startScreen.style.display = "none";
    AudioSys.windStart();
  }

  // ---------- Damage overlay ----------
  let damageT = 0;
  function flashDamage() {
    damageT = 0.4;
    ui.damage.style.background = "rgba(255,0,0,0.35)";
  }

  // ---------- Collision ----------
  function handleCollisions(dt) {
    // Bullets vs enemies
    for (let b of bullets) {
      if (b.life <= 0) continue;
      for (let e of enemies) {
        if (e.dead) continue;
        if (dist2(b.x, b.y, e.x, e.y) < (b.r + e.r) ** 2) {
          b.life = 0;
          e.takeDamage(b.dmg);
          break;
        }
      }
    }

    // Remove dead enemies and decrement wave alive count
    const before = enemies.length;
    enemies = enemies.filter(e => !e.dead);
    const after = enemies.length;
    if (after < before) Spawn.aliveThisWave -= (before - after);

    // Cleanup bullets / particles
    bullets = bullets.filter(b => b.life > 0);
    particles = particles.filter(p => p.life > 0);
  }

  // ---------- Rendering ----------
  function drawBackground() {
    // Plain sand
    ctx.fillStyle = "#cdb27a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Sand dots (stone textures)
    for (const d of sandDots) {
      const sx = d.x - cam.x;
      const sy = d.y - cam.y;
      if (sx < -10 || sy < -10 || sx > canvas.width + 10 || sy > canvas.height + 10) continue;
      ctx.fillStyle = `rgba(90,70,30,${d.a})`;
      ctx.beginPath(); ctx.arc(sx, sy, d.r, 0, TAU); ctx.fill();
    }

    // Arena border (visible if near)
    ctx.strokeStyle = "rgba(60,40,10,0.7)";
    ctx.lineWidth = 8;
    ctx.strokeRect(-cam.x, -cam.y, world.w, world.h);
  }

  function drawObstacles() {
    for (const o of world.obstacles) {
      const sx = o.x - cam.x, sy = o.y - cam.y;
      if (sx + o.w < -50 || sy + o.h < -50 || sx > canvas.width + 50 || sy > canvas.height + 50) continue;

      if (o.type === "pillar") {
        ctx.fillStyle = "#7a6a4b";
        ctx.fillRect(sx, sy, o.w, o.h);
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(sx + 8, sy + 6, o.w - 16, o.h - 12);
      } else {
        ctx.fillStyle = "#6e5b3b";
        ctx.fillRect(sx, sy, o.w, o.h);
        ctx.fillStyle = "#4a3c27";
        ctx.fillRect(sx + 20, sy + 10, o.w - 40, o.h - 20);
      }
    }
  }

  function drawCrosshair() {
    const cx = canvas.width / (window.devicePixelRatio || 1) / 2;
    const cy = canvas.height / (window.devicePixelRatio || 1) / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy);
    ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8);
    ctx.stroke();
  }

  function drawWeaponOverlay() {
    const w = player.weapon;
    const cx = canvas.width / (window.devicePixelRatio || 1) / 2;
    const cy = canvas.height / (window.devicePixelRatio || 1) / 2;
    const a = input.aimAngle;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);

    // base gun block
    ctx.fillStyle = "#222";
    ctx.fillRect(10, -6, 34, 12);

    if (w instanceof Pistol) {
      ctx.fillStyle = "#444";
      ctx.fillRect(18, -4, 18, 8);
    } else if (w instanceof Shotgun) {
      ctx.fillStyle = "#444";
      ctx.fillRect(12, -3, 48, 6);
      ctx.fillStyle = "#7a5a2a";
      ctx.fillRect(0, -7, 16, 14); // stock
    } else if (w instanceof Minigun) {
      const rot = w.rot;
      ctx.fillStyle = "#333";
      ctx.fillRect(6, -7, 56, 14);
      // rotating barrels at front
      ctx.save();
      ctx.translate(64, 0);
      ctx.rotate(rot);
      ctx.strokeStyle = "#999"; ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        const ang = i * (TAU / 4);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ang) * 8, Math.sin(ang) * 8);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore();
  }

  function render() {
    // Camera centered on player
    cam.x = clamp(player.x - canvas.width / (window.devicePixelRatio || 1) / 2, 0, world.w - canvas.width / (window.devicePixelRatio || 1));
    cam.y = clamp(player.y - canvas.height / (window.devicePixelRatio || 1) / 2, 0, world.h - canvas.height / (window.devicePixelRatio || 1));

    drawBackground();
    drawObstacles();

    // Enemies
    for (const e of enemies) e.draw(cam);

    // Bullets
    for (const b of bullets) b.draw(cam);

    // Player
    player.draw(cam);

    // Particles
    for (const p of particles) p.draw(cam);

    // Overlays
    drawWeaponOverlay();
    drawCrosshair();
  }

  // ---------- Main Loop ----------
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    if (game.state === "playing") {
      player.update(dt);

      for (const e of enemies) e.update(dt);
      for (const b of bullets) b.update(dt);
      for (const p of particles) p.update(dt);

      Spawn.update(dt);
      handleCollisions(dt);

      // Damage overlay decay
      if (damageT > 0) {
        damageT -= dt;
        if (damageT <= 0) ui.damage.style.background = "rgba(255,0,0,0.0)";
      }

      render();
    } else {
      // still render background when paused for context
      if (player) render();
    }

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---------- Start / Restart buttons ----------
  ui.startBtn.onclick = () => resetGame();
  ui.restartBtn.onclick = () => resetGame();
  ui.restartBtn2.onclick = () => resetGame();

  // Show start screen
  ui.startScreen.style.display = "grid";

})();
