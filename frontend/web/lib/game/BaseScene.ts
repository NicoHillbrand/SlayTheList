import Phaser from "phaser";
import {
  TILE_WIDTH,
  TILE_HEIGHT,
  GRID_COLS,
  GRID_ROWS,
  gridToScreen,
  screenToGrid,
  snapToGrid,
  isInBounds,
  isoDepth,
} from "./iso";
import { getCatalogItem, type CatalogItem } from "./catalog";
import { renderBuilding } from "./renderers";
import { SPRITE_ASSETS, spriteKey, hasSprite } from "./sprites";
import type { BaseCurrencyType, BaseInventory, BaseState, BuildingPlacement, Progression } from "@slaythelist/contracts";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8788";

interface PlacedBuilding {
  placement: BuildingPlacement;
  sprites: Phaser.GameObjects.GameObject[];
  label: Phaser.GameObjects.Text;
}

export class BaseScene extends Phaser.Scene {
  private grid: (string | null)[][] = [];
  private placedBuildings: PlacedBuilding[] = [];
  private baseState: BaseState | null = null;
  private progression: Progression | null = null;

  // Placement mode
  private placingItem: CatalogItem | null = null;
  private placementGhost: Phaser.GameObjects.Graphics | null = null;
  private ghostCol = 0;
  private ghostRow = 0;
  private placingRotation = 0;

  // Selection
  private selectedBuilding: PlacedBuilding | null = null;
  private selectionHighlight: Phaser.GameObjects.Graphics | null = null;
  private selectionUI: Phaser.GameObjects.Container | null = null;

  // Camera drag
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private camStartX = 0;
  private camStartY = 0;

  // UI
  private goldText!: Phaser.GameObjects.Text;
  private diamondText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;

  // Callbacks for React
  onStateChange?: () => void;
  onReady?: () => void;
  onPurchaseSound?: () => void;

  constructor() {
    super("BaseScene");
  }

  preload() {
    for (const [itemId, asset] of Object.entries(SPRITE_ASSETS)) {
      this.load.image(spriteKey(itemId), `/assets/${asset.path}`);
    }
  }

  async create() {
    this.grid = Array.from({ length: GRID_ROWS }, () =>
      Array.from({ length: GRID_COLS }, () => null),
    );

    this.drawGroundTiles();

    const center = gridToScreen(GRID_COLS / 2, GRID_ROWS / 2);
    this.cameras.main.centerOn(center.x, center.y);
    this.cameras.main.setZoom(1);

    // HUD
    this.goldText = this.add
      .text(16, 56, "Gold: ...", {
        fontSize: "16px",
        color: "#ffd700",
        backgroundColor: "#000000aa",
        padding: { x: 8, y: 4 },
      })
      .setScrollFactor(0)
      .setDepth(10000);

    this.diamondText = this.add
      .text(16, 84, "Diamonds: ...", {
        fontSize: "16px",
        color: "#b9f2ff",
        backgroundColor: "#000000aa",
        padding: { x: 8, y: 4 },
      })
      .setScrollFactor(0)
      .setDepth(10000);

    this.statusText = this.add
      .text(16, 112, "", {
        fontSize: "14px",
        color: "#ffffff",
        backgroundColor: "#000000aa",
        padding: { x: 8, y: 4 },
      })
      .setScrollFactor(0)
      .setDepth(10000);

    // Input
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown() || pointer.middleButtonDown()) {
        if (this.placingItem) {
          // Right-click cancels placement
          this.cancelPlacement();
        } else {
          // Right/middle-click drag for camera
          this.isDragging = true;
          this.dragStartX = pointer.x;
          this.dragStartY = pointer.y;
          this.camStartX = this.cameras.main.scrollX;
          this.camStartY = this.cameras.main.scrollY;
        }
      } else if (pointer.leftButtonDown()) {
        if (this.placingItem) {
          this.tryPlaceBuilding();
        } else {
          // Try to select a building
          this.trySelectBuilding(pointer);
        }
      }
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.isDragging) {
        this.cameras.main.scrollX = this.camStartX - (pointer.x - this.dragStartX);
        this.cameras.main.scrollY = this.camStartY - (pointer.y - this.dragStartY);
      }

      if (this.placingItem && this.placementGhost) {
        this.placementGhost.setVisible(true);
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const grid = screenToGrid(worldPoint.x, worldPoint.y);
        const snapped = snapToGrid(grid.col, grid.row);
        this.ghostCol = snapped.col;
        this.ghostRow = snapped.row;
        this.updateGhost();
      }
    });

    this.input.on("pointerup", () => {
      if (this.isDragging) {
        this.isDragging = false;
      }
    });

    this.input.on("wheel", (_pointer: Phaser.Input.Pointer, _dx: number, _dy: number, dz: number) => {
      const cam = this.cameras.main;
      cam.setZoom(Phaser.Math.Clamp(cam.zoom - dz * 0.001, 0.4, 2.5));
    });

    this.input.keyboard?.on("keydown-ESC", () => {
      if (this.placingItem) {
        this.cancelPlacement();
      } else {
        this.clearSelection();
      }
    });

    this.input.keyboard?.on("keydown-R", () => {
      if (this.placingItem) {
        this.placingRotation = (this.placingRotation + 1) % 4;
        this.updateGhost();
      } else if (this.selectedBuilding) {
        this.rotateSelected();
      }
    });

    this.game.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    await this.loadData();
    this.onReady?.();
  }

  /** Simple seeded random for consistent per-tile variation. */
  private tileRand(col: number, row: number, seed = 0): number {
    let h = (col * 374761393 + row * 668265263 + seed * 1013904223) | 0;
    h = ((h ^ (h >> 13)) * 1274126177) | 0;
    return ((h ^ (h >> 16)) >>> 0) / 4294967296;
  }

  private drawGroundTiles() {
    const groundLayer = this.add.graphics();
    groundLayer.setDepth(-1);

    // Base grass colors with natural variation
    const grassColors = [0x5a8f47, 0x4d7f3a, 0x52873e, 0x478235, 0x3f7530];

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const { x, y } = gridToScreen(col, row);
        const hw = TILE_WIDTH / 2;
        const hh = TILE_HEIGHT / 2;

        // Pick a base color with seeded randomness
        const r = this.tileRand(col, row);
        const baseColor = grassColors[Math.floor(r * grassColors.length)];

        // Fill the diamond
        groundLayer.fillStyle(baseColor, 1);
        groundLayer.beginPath();
        groundLayer.moveTo(x, y - hh);
        groundLayer.lineTo(x + hw, y);
        groundLayer.lineTo(x, y + hh);
        groundLayer.lineTo(x - hw, y);
        groundLayer.closePath();
        groundLayer.fillPath();

        // Add subtle lighter patches for texture
        const patchCount = 2 + Math.floor(this.tileRand(col, row, 1) * 3);
        for (let p = 0; p < patchCount; p++) {
          const pr = this.tileRand(col, row, 10 + p);
          const pr2 = this.tileRand(col, row, 20 + p);
          // Random position within the diamond
          const t1 = pr * 0.6 + 0.2;
          const t2 = pr2 * 0.6 + 0.2;
          const px = x + (t1 - 0.5) * hw * 1.2;
          const py = y + (t2 - 0.5) * hh * 1.2;
          const patchSize = 3 + pr * 5;
          const lighter = this.tileRand(col, row, 30 + p) > 0.5;
          groundLayer.fillStyle(lighter ? 0x6aa852 : 0x3d6b30, 0.3);
          groundLayer.fillEllipse(px, py, patchSize, patchSize * 0.6);
        }

        // Grass blade details — small lines pointing up
        const bladeCount = 3 + Math.floor(this.tileRand(col, row, 2) * 4);
        groundLayer.lineStyle(1, 0x6aad52, 0.4);
        for (let b = 0; b < bladeCount; b++) {
          const br = this.tileRand(col, row, 40 + b);
          const br2 = this.tileRand(col, row, 50 + b);
          const bx = x + (br - 0.5) * hw * 0.8;
          const by = y + (br2 - 0.5) * hh * 0.8;
          const blen = 2 + br * 3;
          const bangle = -0.3 + br2 * 0.6;
          groundLayer.lineBetween(bx, by, bx + Math.sin(bangle) * blen, by - blen);
        }

        // Very subtle grid edge (barely visible)
        groundLayer.lineStyle(1, 0x3a6028, 0.15);
        groundLayer.beginPath();
        groundLayer.moveTo(x, y - hh);
        groundLayer.lineTo(x + hw, y);
        groundLayer.lineTo(x, y + hh);
        groundLayer.lineTo(x - hw, y);
        groundLayer.closePath();
        groundLayer.strokePath();
      }
    }

    // Add some random edge grass tufts outside the grid for a more natural look
    const edgeGrass = this.add.graphics();
    edgeGrass.setDepth(-2);

    // Outer grass area (soft green surrounding the grid)
    for (let i = 0; i < 40; i++) {
      const angle = (i / 40) * Math.PI * 2;
      const center = gridToScreen(GRID_COLS / 2, GRID_ROWS / 2);
      const dist = 340 + Math.sin(i * 3.7) * 40;
      const ex = center.x + Math.cos(angle) * dist;
      const ey = center.y + Math.sin(angle) * dist * 0.5;
      edgeGrass.fillStyle(0x3d6b30, 0.15);
      edgeGrass.fillEllipse(ex, ey, 30 + Math.sin(i * 2.3) * 15, 12);
    }
  }

  private async loadData() {
    try {
      const [baseRes, progRes] = await Promise.all([
        fetch(`${API_BASE}/api/base-state`).then((r) => r.json()) as Promise<BaseState>,
        fetch(`${API_BASE}/api/progression`).then((r) => r.json()) as Promise<Progression>,
      ]);
      this.baseState = baseRes;
      this.progression = progRes;
      this.updateCurrencyDisplay();

      try {
        const diamondCheck = await fetch(`${API_BASE}/api/base-diamonds/check`, { method: "POST" }).then((r) => r.json());
        if (diamondCheck.awarded > 0) {
          this.baseState = await fetch(`${API_BASE}/api/base-state`).then((r) => r.json());
          this.progression = await fetch(`${API_BASE}/api/progression`).then((r) => r.json());
          this.updateCurrencyDisplay();
        }
      } catch { /* non-critical */ }

      for (const placement of this.baseState?.placements ?? []) {
        this.renderPlacedBuilding(placement);
      }

      this.onStateChange?.();
    } catch (err) {
      console.error("Failed to load base data:", err);
      this.statusText.setText("Failed to connect to API");
    }
  }

  private renderPlacedBuilding(placement: BuildingPlacement): PlacedBuilding | null {
    const item = getCatalogItem(placement.itemId);
    if (!item) return null;

    const sprites: Phaser.GameObjects.GameObject[] = [];
    const [fw, fh] = item.footprint;
    const color = Phaser.Display.Color.HexStringToColor(item.color).color;

    // Mark grid cells as occupied
    for (let dr = 0; dr < fh; dr++) {
      for (let dc = 0; dc < fw; dc++) {
        const col = placement.x + dc;
        const row = placement.y + dr;
        if (isInBounds(col, row)) {
          this.grid[row][col] = placement.itemId;
        }
      }
    }

    // Render the building graphic centered on the footprint
    const centerCol = placement.x + (fw - 1) / 2;
    const centerRow = placement.y + (fh - 1) / 2;
    const { x, y } = gridToScreen(centerCol, centerRow);
    const depth = isoDepth(centerCol, centerRow) * 10 + 2;

    if (hasSprite(placement.itemId)) {
      const asset = SPRITE_ASSETS[placement.itemId];
      const img = this.add.image(x, y + asset.offsetY, spriteKey(placement.itemId));
      img.setDisplaySize(asset.width, asset.height);
      img.setDepth(depth);
      sprites.push(img);
    } else {
      const g = this.add.graphics();
      g.setDepth(depth);
      renderBuilding(g, x, y, placement.itemId, color, placement.rotation);
      sprites.push(g);
    }

    // Hidden label (only shown on selection)
    const label = this.add.text(x, y - 52, item.name, {
      fontSize: "9px",
      color: "#ffffffcc",
      backgroundColor: "#00000066",
      padding: { x: 3, y: 1 },
    });
    label.setOrigin(0.5, 0.5);
    label.setDepth(isoDepth(centerCol, centerRow) * 10 + 3);
    label.setVisible(false);

    const placed: PlacedBuilding = { placement, sprites, label };
    this.placedBuildings.push(placed);
    return placed;
  }

  private removePlacedBuilding(building: PlacedBuilding) {
    const item = getCatalogItem(building.placement.itemId);
    const [fw, fh] = item?.footprint ?? [1, 1];

    // Clear grid cells
    for (let dr = 0; dr < fh; dr++) {
      for (let dc = 0; dc < fw; dc++) {
        const col = building.placement.x + dc;
        const row = building.placement.y + dr;
        if (isInBounds(col, row)) {
          this.grid[row][col] = null;
        }
      }
    }

    // Destroy sprites
    for (const s of building.sprites) s.destroy();
    building.label.destroy();

    // Remove from list
    this.placedBuildings = this.placedBuildings.filter((b) => b !== building);
  }

  private trySelectBuilding(pointer: Phaser.Input.Pointer) {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const grid = screenToGrid(worldPoint.x, worldPoint.y);
    const snapped = snapToGrid(grid.col, grid.row);

    if (!isInBounds(snapped.col, snapped.row)) {
      this.clearSelection();
      return;
    }

    const itemId = this.grid[snapped.row]?.[snapped.col];
    if (!itemId) {
      this.clearSelection();
      return;
    }

    const building = this.placedBuildings.find((b) => {
      const item = getCatalogItem(b.placement.itemId);
      if (!item) return false;
      const [fw, fh] = item.footprint;
      return (
        snapped.col >= b.placement.x &&
        snapped.col < b.placement.x + fw &&
        snapped.row >= b.placement.y &&
        snapped.row < b.placement.y + fh
      );
    });

    if (!building) {
      this.clearSelection();
      return;
    }

    // If clicking the already selected building, deselect
    if (this.selectedBuilding === building) {
      this.clearSelection();
      return;
    }

    this.selectBuilding(building);
  }

  private selectBuilding(building: PlacedBuilding) {
    this.clearSelection();
    this.selectedBuilding = building;
    building.label.setVisible(true);

    const item = getCatalogItem(building.placement.itemId);
    if (!item) return;
    const [fw, fh] = item.footprint;

    // Draw selection highlight
    this.selectionHighlight = this.add.graphics();
    this.selectionHighlight.setDepth(9000);

    for (let dr = 0; dr < fh; dr++) {
      for (let dc = 0; dc < fw; dc++) {
        const col = building.placement.x + dc;
        const row = building.placement.y + dr;
        const { x, y } = gridToScreen(col, row);

        this.selectionHighlight.lineStyle(2, 0xffff00, 0.9);
        this.selectionHighlight.beginPath();
        this.selectionHighlight.moveTo(x, y - TILE_HEIGHT / 2);
        this.selectionHighlight.lineTo(x + TILE_WIDTH / 2, y);
        this.selectionHighlight.lineTo(x, y + TILE_HEIGHT / 2);
        this.selectionHighlight.lineTo(x - TILE_WIDTH / 2, y);
        this.selectionHighlight.closePath();
        this.selectionHighlight.strokePath();
      }
    }

    // Create action buttons at the building's position
    const pos = gridToScreen(building.placement.x, building.placement.y);
    this.selectionUI = this.add.container(pos.x, pos.y - 52);
    this.selectionUI.setDepth(9500);

    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.85);
    bg.fillRoundedRect(-56, -14, 112, 28, 6);
    bg.lineStyle(1, 0xffff00, 0.6);
    bg.strokeRoundedRect(-56, -14, 112, 28, 6);
    // Divider
    bg.lineStyle(1, 0x666666, 0.5);
    bg.lineBetween(0, -10, 0, 10);
    this.selectionUI.add(bg);

    // Rotate button (left)
    const rotateText = this.add.text(-28, 0, "Rotate", { fontSize: "11px", color: "#88ccff" });
    rotateText.setOrigin(0.5, 0.5);
    this.selectionUI.add(rotateText);

    const rotateHit = this.add.rectangle(-28, 0, 52, 24);
    rotateHit.setOrigin(0.5, 0.5);
    rotateHit.setInteractive({ useHandCursor: true });
    rotateHit.on("pointerdown", () => { this.rotateSelected(); });
    this.selectionUI.add(rotateHit);

    // Pick up button (right)
    const pickupText = this.add.text(28, 0, "Pick up", { fontSize: "11px", color: "#ffff00" });
    pickupText.setOrigin(0.5, 0.5);
    this.selectionUI.add(pickupText);

    const pickupHit = this.add.rectangle(28, 0, 52, 24);
    pickupHit.setOrigin(0.5, 0.5);
    pickupHit.setInteractive({ useHandCursor: true });
    pickupHit.on("pointerdown", () => { this.pickUpSelected(); });
    this.selectionUI.add(pickupHit);
  }

  private clearSelection() {
    this.selectedBuilding?.label.setVisible(false);
    this.selectedBuilding = null;
    this.selectionHighlight?.destroy();
    this.selectionHighlight = null;
    this.selectionUI?.destroy();
    this.selectionUI = null;
  }

  private rotateSelected() {
    if (!this.selectedBuilding) return;
    const building = this.selectedBuilding;
    building.placement.rotation = ((building.placement.rotation ?? 0) + 1) % 4;

    // Re-render the building
    const item = getCatalogItem(building.placement.itemId);
    if (!item) return;
    const [fw, fh] = item.footprint;
    for (const s of building.sprites) s.destroy();
    building.sprites = [];

    const centerCol = building.placement.x + (fw - 1) / 2;
    const centerRow = building.placement.y + (fh - 1) / 2;
    const { x, y } = gridToScreen(centerCol, centerRow);
    const depth = isoDepth(centerCol, centerRow) * 10 + 2;

    if (hasSprite(building.placement.itemId)) {
      const asset = SPRITE_ASSETS[building.placement.itemId];
      const img = this.add.image(x, y + asset.offsetY, spriteKey(building.placement.itemId));
      img.setDisplaySize(asset.width, asset.height);
      img.setDepth(depth);
      // Flip for rotation (simple approach for sprites)
      img.setFlipX(building.placement.rotation === 1 || building.placement.rotation === 2);
      building.sprites.push(img);
    } else {
      const color = Phaser.Display.Color.HexStringToColor(item.color).color;
      const g = this.add.graphics();
      g.setDepth(depth);
      renderBuilding(g, x, y, building.placement.itemId, color, building.placement.rotation);
      building.sprites.push(g);
    }

    this.saveState();
  }

  private pickUpSelected() {
    if (!this.selectedBuilding) return;
    const building = this.selectedBuilding;

    this.removePlacedBuilding(building);
    if (this.baseState) {
      const inv = { ...this.baseState.inventory };
      inv[building.placement.itemId] = (inv[building.placement.itemId] ?? 0) + 1;
      this.baseState.inventory = inv;
    }

    this.clearSelection();
    this.statusText.setText(`Picked up ${getCatalogItem(building.placement.itemId)?.name ?? building.placement.itemId}`);
    setTimeout(() => this.statusText.setText(""), 2000);

    this.onStateChange?.();
    this.saveState();
  }

  /** Start placement mode from inventory. Called from React UI. */
  startPlacement(itemId: string) {
    const item = getCatalogItem(itemId);
    if (!item) return;

    // Check inventory
    const stock = this.baseState?.inventory[itemId] ?? 0;
    if (stock <= 0) return;

    if (this.placingItem) this.cancelPlacement();
    this.clearSelection();

    this.placingItem = item;
    this.placingRotation = 0;
    this.statusText.setText(`Placing: ${item.name} (click to place, R to rotate, right-click/ESC to cancel)`);

    this.placementGhost = this.add.graphics();
    this.placementGhost.setDepth(9999);
    this.placementGhost.setVisible(false);
  }

  cancelPlacement() {
    this.placingItem = null;
    this.placementGhost?.destroy();
    this.placementGhost = null;
    this.statusText.setText("");
  }

  private updateGhost() {
    if (!this.placementGhost || !this.placingItem) return;
    this.placementGhost.clear();

    const [fw, fh] = this.placingItem.footprint;
    const canPlace = this.canPlace(this.ghostCol, this.ghostRow, fw, fh);
    const tintColor = canPlace ? 0x00ff00 : 0xff0000;

    // Draw tile outlines
    for (let dr = 0; dr < fh; dr++) {
      for (let dc = 0; dc < fw; dc++) {
        const col = this.ghostCol + dc;
        const row = this.ghostRow + dr;
        const { x, y } = gridToScreen(col, row);

        this.placementGhost.fillStyle(tintColor, 0.2);
        this.placementGhost.beginPath();
        this.placementGhost.moveTo(x, y - TILE_HEIGHT / 2);
        this.placementGhost.lineTo(x + TILE_WIDTH / 2, y);
        this.placementGhost.lineTo(x, y + TILE_HEIGHT / 2);
        this.placementGhost.lineTo(x - TILE_WIDTH / 2, y);
        this.placementGhost.closePath();
        this.placementGhost.fillPath();

        this.placementGhost.lineStyle(2, tintColor, 0.7);
        this.placementGhost.strokePath();
      }
    }

    // Draw building preview
    if (canPlace) {
      const centerCol = this.ghostCol + (fw - 1) / 2;
      const centerRow = this.ghostRow + (fh - 1) / 2;
      const { x, y } = gridToScreen(centerCol, centerRow);
      const color = Phaser.Display.Color.HexStringToColor(this.placingItem.color).color;
      this.placementGhost.setAlpha(0.6);
      renderBuilding(this.placementGhost, x, y, this.placingItem.id, color, this.placingRotation);
      this.placementGhost.setAlpha(1);
    }
  }

  private canPlace(col: number, row: number, fw: number, fh: number): boolean {
    for (let dr = 0; dr < fh; dr++) {
      for (let dc = 0; dc < fw; dc++) {
        const c = col + dc;
        const r = row + dr;
        if (!isInBounds(c, r)) return false;
        if (this.grid[r][c] !== null) return false;
      }
    }
    return true;
  }

  private async tryPlaceBuilding() {
    if (!this.placingItem) return;
    const [fw, fh] = this.placingItem.footprint;
    if (!this.canPlace(this.ghostCol, this.ghostRow, fw, fh)) return;

    const item = this.placingItem;

    // Deduct from inventory
    if (this.baseState) {
      const stock = this.baseState.inventory[item.id] ?? 0;
      if (stock <= 0) {
        this.cancelPlacement();
        return;
      }
      const inv = { ...this.baseState.inventory };
      inv[item.id] = stock - 1;
      if (inv[item.id] <= 0) delete inv[item.id];
      this.baseState.inventory = inv;
    }

    const placement: BuildingPlacement = {
      itemId: item.id,
      x: this.ghostCol,
      y: this.ghostRow,
      rotation: this.placingRotation,
      flipped: false,
    };

    this.renderPlacedBuilding(placement);
    this.cancelPlacement();
    this.onStateChange?.();
    await this.saveState();
  }

  private async saveState() {
    const placements = this.placedBuildings.map((b) => b.placement);
    const inventory = this.baseState?.inventory ?? {};
    try {
      const res = await fetch(`${API_BASE}/api/base-state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placements, inventory, currencies: this.baseState?.currencies ?? { gold: 0, diamonds: 0, emeralds: 0 }, diamondMilestones: this.baseState?.diamondMilestones ?? [] }),
      });
      this.baseState = await res.json();
    } catch (err) {
      console.error("Failed to save base state:", err);
    }
  }

  /** Buy an item — charges currency and adds to inventory. Called from React UI. */
  async buyItem(itemId: string, cost: number, currency: BaseCurrencyType): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/api/base-shop/purchase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, cost, currency }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (this.baseState) {
        this.baseState.inventory = data.inventory;
      }
      if (this.progression) {
        this.progression.gold = data.gold;
        this.progression.diamonds = data.diamonds;
        this.progression.emeralds = data.emeralds;
      }
      this.updateCurrencyDisplay();
      this.onPurchaseSound?.();
      this.onStateChange?.();
      return true;
    } catch {
      return false;
    }
  }

  private updateCurrencyDisplay() {
    if (!this.progression) return;
    this.goldText.setText(`Gold: ${this.progression.gold}`);
    this.diamondText.setText(`Diamonds: ${this.progression.diamonds}`);
  }

  getProgression(): Progression | null {
    return this.progression;
  }

  getInventory(): BaseInventory {
    return this.baseState?.inventory ?? {};
  }
}
