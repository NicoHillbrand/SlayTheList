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
import { SPRITE_ASSETS, spriteKey, hasSprite, GROUND_TILES, groundTileKey } from "./sprites";
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
  private placementGhostSprite: Phaser.GameObjects.Image | null = null;
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
    for (const [name, path] of Object.entries(GROUND_TILES)) {
      this.load.image(groundTileKey(name as keyof typeof GROUND_TILES), `/assets/${path}`);
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

    this.setupUiCamera();

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

  /** A second camera at zoom=1 renders only the HUD; the main camera ignores
   *  HUD elements. This way scroll/zoom on the main camera never affects HUD
   *  position or size. New world objects added later are auto-ignored by the
   *  UI camera via the ADDED_TO_SCENE event. */
  private setupUiCamera() {
    const uiObjects = new Set<Phaser.GameObjects.GameObject>([
      this.goldText, this.diamondText, this.statusText,
    ]);

    this.cameras.main.ignore(Array.from(uiObjects));

    const uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    uiCam.setName("ui");

    // UI camera ignores everything currently in the scene that isn't UI.
    for (const child of this.children.list) {
      if (!uiObjects.has(child)) uiCam.ignore(child);
    }

    // ...and auto-ignores anything added later (buildings, ghosts, etc.).
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, (obj: Phaser.GameObjects.GameObject) => {
      if (!uiObjects.has(obj)) uiCam.ignore(obj);
    });

    // Keep UI camera sized to the canvas if the window resizes.
    this.scale.on("resize", (size: Phaser.Structs.Size) => {
      uiCam.setSize(size.width, size.height);
    });
  }

  private drawGroundTiles() {
    // Render the field as a real arrangement of 3D block tiles where each
    // tile shows only the faces that wouldn't be occluded by neighbors:
    //   - interior tile          → diamond face only ("face")
    //   - col=COLS-1 edge        → diamond + right side face ("rightEdge")
    //   - row=ROWS-1 edge        → diamond + left side face  ("leftEdge")
    //   - (COLS-1, ROWS-1) corner → full asset, both side faces ("frontCorner")
    //
    // The 132×83 source PNG is a 3D block whose rectangular bbox includes
    // side-face content in its bottom corners (below the diamond). Rendering
    // the raw PNG would let that side-face content peek through neighboring
    // tiles' transparent corners. We avoid that by pre-processing the source
    // into 4 polygon-clipped CanvasTexture variants, each containing only
    // the faces that variant should show.
    this.prepareGroundVariants();

    const SRC_W = 132;
    const SRC_H = 99;
    const displayW = TILE_WIDTH;                     // 64
    const displayH = displayW * (SRC_H / SRC_W);     // 48
    // Diamond face center is at source (66, 33). The sprite's vertical
    // center is at source y = 49.5, so the face sits 16.5 source-pixels
    // above the sprite center. Scaling by displayW/132 gives the offset
    // needed to put the face center exactly on the grid (x, y).
    const offsetY = displayW * (16.5 / 132);         // 8

    const sourceKey = groundTileKey("grass");

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const { x, y } = gridToScreen(col, row);
        const onRightEdge = col === GRID_COLS - 1;
        const onLeftEdge = row === GRID_ROWS - 1;

        let variant: "face" | "rightEdge" | "leftEdge" | "frontCorner";
        if (onRightEdge && onLeftEdge) variant = "frontCorner";
        else if (onRightEdge) variant = "rightEdge";
        else if (onLeftEdge) variant = "leftEdge";
        else variant = "face";

        const img = this.add.image(x, y + offsetY, `${sourceKey}_${variant}`);
        img.setDisplaySize(displayW, displayH);
        img.setDepth(-1000 + isoDepth(col, row));
      }
    }
  }

  /** Pre-process each ground texture into 4 polygon-clipped variants so
   *  per-tile rendering can show only the faces that aren't occluded by
   *  neighbors. Runs once; subsequent calls are no-ops. */
  private prepareGroundVariants() {
    const SRC_W = 132;
    const SRC_H = 99;
    const halfSrc = SRC_W / 2;     // 66 — diamond top/bottom corner x
    const SIDE_TOP = 33;            // y of diamond left/right corners (= side face top-back)
    const FACE_BOTTOM = 66;         // y of diamond bottom corner (= side face top-front)
    const SIDE_BOTTOM = 66;         // y where side faces end at left/right edges (back-bottom)

    // Each polygon is the outline of the visible region (clockwise from top).
    const variants: Record<string, [number, number][]> = {
      face: [
        [halfSrc, 0],
        [SRC_W, SIDE_TOP],
        [halfSrc, FACE_BOTTOM],
        [0, SIDE_TOP],
      ],
      rightEdge: [
        [halfSrc, 0],
        [SRC_W, SIDE_TOP],
        [SRC_W, SIDE_BOTTOM],
        [halfSrc, SRC_H],
        [halfSrc, FACE_BOTTOM],
        [0, SIDE_TOP],
      ],
      leftEdge: [
        [halfSrc, 0],
        [SRC_W, SIDE_TOP],
        [halfSrc, FACE_BOTTOM],
        [halfSrc, SRC_H],
        [0, SIDE_BOTTOM],
        [0, SIDE_TOP],
      ],
      frontCorner: [
        [halfSrc, 0],
        [SRC_W, SIDE_TOP],
        [SRC_W, SIDE_BOTTOM],
        [halfSrc, SRC_H],
        [0, SIDE_BOTTOM],
        [0, SIDE_TOP],
      ],
    };

    for (const sourceName of Object.keys(GROUND_TILES) as (keyof typeof GROUND_TILES)[]) {
      const sourceKey = groundTileKey(sourceName);
      const sourceImg = this.textures.get(sourceKey).getSourceImage(0) as CanvasImageSource;

      for (const [variantName, polygon] of Object.entries(variants)) {
        const dstKey = `${sourceKey}_${variantName}`;
        if (this.textures.exists(dstKey)) continue;

        const tex = this.textures.createCanvas(dstKey, SRC_W, SRC_H);
        if (!tex) continue;

        const ctx = tex.context;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(polygon[0][0], polygon[0][1]);
        for (let i = 1; i < polygon.length; i++) {
          ctx.lineTo(polygon[i][0], polygon[i][1]);
        }
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(sourceImg, 0, 0);
        ctx.restore();
        tex.refresh();
      }
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

    if (hasSprite(itemId)) {
      const asset = SPRITE_ASSETS[itemId];
      const ghostSprite = this.add.image(0, 0, spriteKey(itemId));
      ghostSprite.setDisplaySize(asset.width, asset.height);
      ghostSprite.setAlpha(0.7);
      ghostSprite.setDepth(9999);
      ghostSprite.setVisible(false);
      this.placementGhostSprite = ghostSprite;
    }
  }

  cancelPlacement() {
    this.placingItem = null;
    this.placementGhost?.destroy();
    this.placementGhost = null;
    this.placementGhostSprite?.destroy();
    this.placementGhostSprite = null;
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
    const centerCol = this.ghostCol + (fw - 1) / 2;
    const centerRow = this.ghostRow + (fh - 1) / 2;
    const { x, y } = gridToScreen(centerCol, centerRow);

    if (this.placementGhostSprite) {
      const asset = SPRITE_ASSETS[this.placingItem.id];
      this.placementGhostSprite.setPosition(x, y + asset.offsetY);
      this.placementGhostSprite.setVisible(true);
      this.placementGhostSprite.setTint(canPlace ? 0xffffff : 0xff8888);
      this.placementGhostSprite.setFlipX(this.placingRotation === 1 || this.placingRotation === 2);
    } else if (canPlace) {
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
