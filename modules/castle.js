import * as glMatrix from './glMatrix/common.js';
import * as vec2 from './glMatrix/vec2.js';
import * as vec3 from './glMatrix/vec3.js';
import * as vec4 from './glMatrix/vec4.js';

import * as mat4 from './glMatrix/mat4.js';

import * as quat from './glMatrix/quat.js';

import { Window } from './window.js';
import { App } from './app.js';
import { HTTP } from './http.js';
import { NativeAPI } from './nativeApi.js';
import { CastleBuildingsEvents } from './castleBuildingEvents.js';
import { Settings } from './settings.js';
import { Sound } from './sound.js';
import { PreloadImages } from './preloadImages.js';
import { DOM } from './dom.js';
import { Lang } from './lang.js';
import { domAudioPresets } from './domAudioPresets.js';
import { SOUNDS_LIBRARY } from './soundsLibrary.js';
import { EaselCastleFx } from './easel/easelCastleFx.js';
import { redrawShadowRect, rotatingShadowRect } from './castleSkin.js';
import { CastlePets } from './castlePets.js';
import { CastleLighting } from './castleLighting.js';
import { CastleFireflies } from './castleFireflies.js';
import { CastleSceneFade, FrameBudget, forEachLimited, yieldFrame } from './castleSceneFade.js';

export class Castle {
  static canvas;

  static gl;

  static AUDIO_MUSIC = 0;
  static AUDIO_SOUNDS = 1;
  static AUDIO_HERO_VOICES = 2;
  static GetVolume(type) {
    // Используем настройки из Settings вместо внутренних переменных
    const global = Settings.settings.globalVolume ?? 1.0;
    const music = Settings.settings.musicVolume ?? 0.5;
    const sounds = Settings.settings.soundsVolume ?? 0.3;

    if (type == Castle.AUDIO_MUSIC) {
      return Settings.settings.musicMuted ? 0 : global * music;
    }
    if (type == Castle.AUDIO_HERO_VOICES) {
      return Settings.settings.heroVoicesMuted ? 0 : global * sounds;
    }
    if (type == Castle.AUDIO_SOUNDS) {
      return global * sounds;
    }
    return 1.0; // Значение по умолчанию
  }
  static testSoundIsPlaying = false;

  static RENDER_LAYER_LAUNCHER = 0;
  static RENDER_LAYER_GAME = 1;
  static RENDER_LAYER_PLAYER = 2;
  static RENDER_LAYER_EASEL = 3; // открыта мини-игра «Мастерская свитков»
  static RENDER_LAYER_BUILD_DRAG = 4; // в билде переносят талант: замок под окном не рисуем, кадр целиком уходит на перенос

  static render = [true, true, true, true, true];

  static MUSIC_LAYER_PLAYER = 0;
  static MUSIC_LAYER_GAME = 1;
  static MUSIC_LAYER_TAMBUR = 2;

  static music = [true, true, true];

  // Очередь треков замка: каждый трек фракции звучит по разу за круг, порядок случайный
  static musicQueue = [];
  static lastMusic = null;

  static identityMatrix;

  static viewMatrix;

  static flipMatr;

  static viewMatrix2;

  static projMatrix;

  static viewProjMatr;

  static cursorBasis = new Float32Array(4);

  static cursorDeltaBasis = new Float32Array(4);

  static cursorBasis2 = new Float32Array(4);

  static viewProjInv = new Float32Array(16);

  static isSMEnabled;

  static isBuildingsLoaded = false;
  static isStaticSMCached = false;

  static lightViewProjMatrix;

  static depthTexture;

  static gridTexture;

  static depthFramebuffer;

  static depthTextureSize = 8192;

  static zNear = 10.0;

  static zFar = 4500.0;

  static canvasWidth;

  static canvasHeight;

  static zNearSM = 0.1;

  static zFarSM = 1200.0;

  static zeroTranslation = [1072, 1360];

  static gridTranslation = [0, 0];

  static gridTranslationY = 0;

  static cursorPosition = [0, 0];

  static gridCursorPosX;

  static gridCursorPosZ;

  static minFov = 35;

  static maxFov = 55;

  static fixedFovValues = [55, 45, 35, 25, 55, 45, 35];

  static fixedRotationTiltValues = [0, 0, 0, 0, -0.8, -0.9, -0.8];

  static fixedCameraHeightValues = [0, 0, 0, 0, 350, 350, 350];

  static START_FIXED_VALUE = 1.0;

  static initialFixedValue = Castle.START_FIXED_VALUE;

  static currentFixedValue = Castle.START_FIXED_VALUE;

  static targetFixedValue = Castle.START_FIXED_VALUE;

  static cameraAnimationSpeed = 4.0;

  static fov = Castle.fixedFovValues[Math.floor(Castle.currentFixedValue)];

  static rotationTilt = Castle.fixedRotationTiltValues[Math.floor(Castle.currentFixedValue)];

  static cameraHeight = Castle.fixedCameraHeightValues[Math.floor(Castle.currentFixedValue)];

  static doMove = false;
  static wasMoved = false;

  static cursorDeltaPos = [0.0, 0.0];

  static camDeltaPos = [0.0, 0.0];

  static camDeltaPosMinMax = [
    [-50, 10],
    [-50, 10],
  ];

  static loadTime = Date.now();

  static currentTime = Date.now();

  static prevTime = Date.now();

  static deltaTime = 0;

  static scenesJson;

  static globalCanvas;

  static currentSceneName;

  static sceneObjects = [];

  static #buildMode = false;

  // выход из Строительства: перетаскиваемое здание возвращается на место, ожидающее — исчезает
  static get buildMode() {
    return Castle.#buildMode;
  }

  static set buildMode(value) {
    const wasBuildMode = Castle.#buildMode;
    Castle.#buildMode = Boolean(value);
    if (wasBuildMode && !Castle.#buildMode) {
      Castle.cancelBuildInteraction();
    }
    if (wasBuildMode !== Castle.#buildMode) {
      Castle.renderPendingTray();
    }
  }

  static buildings = [
    'grid',

    'crystal_farm',
    'food_farm',
    'heavy_farm',
    'light_farm',
    'silver_farm',
    'talent_farm',

    'clan_house',
    'fair',
    'house',
    'library',
    'storage',

    'agility',
    'cunning',
    'health',
    'intelligence',
    'strength',
    'tavern',

    'cat',
    'dog',
    'unicorn',

    'deco_0',
    'deco_1',
    'deco_2',
    'deco_3',
    'deco_4',
    'deco_5',
    'deco_6',
    'deco_7',
    'deco_8',
    'deco_9',
    'deco_10',
    'deco_11',
    'deco_12',
    'deco_13',
    'deco_14',
    'deco_15',
    'deco_16',
    'deco_17',
    'deco_18',
    'deco_19',
    'deco_20',
    'deco_21',
    'deco_22',
    'deco_23',
    'deco_24',
    'deco_25',
    'deco_26',
    'deco_27',
    'deco_28',
    'deco_29',
    'deco_30',
    'deco_31',
    'deco_32',

    // Мини-игра «Мастерская свитков» (Easel из PW: Buildings/A|B/MiniGame)
    'easel',
  ];

  static defaultPlacedBuildings = [
    {
      id: '2',
      rot: 0,
      posX: 39,
      posY: 1,
    },
    {
      id: '1',
      rot: 0,
      posX: 31,
      posY: 1,
    },
    {
      id: '3',
      rot: 2,
      posX: 25,
      posY: 3,
    },
    {
      id: '5',
      rot: 2,
      posX: 39,
      posY: 7,
    },
    {
      id: '11',
      rot: 0,
      posX: 27,
      posY: 15,
    },
    {
      id: '13',
      rot: 0,
      posX: 0,
      posY: 17,
    },
    {
      id: '14',
      rot: 0,
      posX: 5,
      posY: 17,
    },
    {
      id: '15',
      rot: 0,
      posX: 0,
      posY: 22,
    },
    {
      id: '16',
      rot: 0,
      posX: 5,
      posY: 22,
    },
    {
      id: '17',
      rot: 0,
      posX: 0,
      posY: 27,
    },
    {
      id: '18',
      rot: 2,
      posX: 34,
      posY: 21,
    },
    {
      id: '19',
      rot: 2,
      posX: 28,
      posY: 21,
    },
    {
      id: '6',
      rot: 0,
      posX: 10,
      posY: 29,
    },
    {
      id: '20',
      rot: 2,
      posX: 33,
      posY: 9,
    },
    {
      id: '27',
      rot: 0,
      posX: 5,
      posY: 27,
    },
    {
      id: '25',
      rot: 0,
      posX: 0,
      posY: 33,
    },
    {
      id: '10',
      rot: 0,
      posX: 21,
      posY: 20,
    },
    {
      id: '8',
      rot: 0,
      posX: 25,
      posY: 9,
    },
    {
      id: '7',
      rot: 0,
      posX: 18,
      posY: 14,
    },
    {
      id: '12',
      rot: 2,
      posX: 40,
      posY: 14,
    },
  ];

  static placedBuildings = [];

  static buildingBubblesDoms = {};

  static allowedToBuildGridTex = new Uint8Array(64 * 64 * 4).fill(0);
  static allowedToBuildGrid = Array.from(Array(47), () => new Array(38)); // номер стоящего здания + 1 или пусто
  // чьи клетки: номер здания (R — младший байт, G — старший). Шейдер сетки сливает клетки одного здания
  // в одну плитку и обводит её по краю — так видно, где кончается одно здание и начинается другое.
  static gridIdTex = new Uint8Array(64 * 64 * 4).fill(0);
  static gridIdTexture;
  static GRID_ID_MOVE_BASE = 1800; // куда переедут вытесненные здания (номера < 2048: в шейдере mediump)
  static GRID_ID_PHANTOM = 2000; // ставящееся здание

  static phantomBuildingSize = 0;
  static phantomBuilding = {
    id: 0,
    rot: 0,
    posX: 0,
    posY: 1000,
  };
  static BUILDING_OUTLINE_BAD = [40, 0, 0, 2];
  static BUILDING_OUTLINE_GOOD = [0, 40, 0, 2];
  static BUILDING_OUTLINE_SELECTION = [40, 40, 0, 2];
  static phantomBuildingIsAllowedToBuild = false;

  // Перемещение здания зажатым ПКМ (только в режиме строительства).
  // dragCandidate — ПКМ нажат на здании, но мышь ещё не сдвинулась (отпустили на месте — снос, как раньше);
  // draggedBuilding — здание снято с места и едет за курсором как фантом;
  // dragSwapPlan — куда встанут здание и те, на которые его кладут (обмен местами);
  // pendingBuildings — вытесненные здания, которым не нашлось места: ждут в панели у нижнего края экрана
  // (Castle.pendingTray), пока их не поставят; при выходе из Строительства исчезают.
  // placingPending — ожидающее здание, которое взяли из панели и ставят (ЛКМ — поставить, ПКМ — вернуть в панель).
  static DRAG_START_THRESHOLD_PX = 4;
  static dragCandidate = null;
  static draggedBuilding = null;
  static dragSwapPlan = null;
  static pendingBuildings = [];
  static placingPending = null;
  static pendingTray = null;
  static suppressContextMenu = false;

  // Отмена действий в Строительстве: перед каждой постройкой, сносом, поворотом и перестановкой
  // запоминается расстановка (стоящие и ждущие здания). Живёт, пока открыто Строительство.
  static UNDO_LIMIT = 50;
  static undoStack = [];

  static buildingsNames = [
    ['', ''],
    ['pearl_farm_ad', 'pearl_farm_doct'],
    ['mushroom_farm_ad', 'mushroom_farm_doct'],
    ['rubber_tree_ad', 'rubber_tree_doct'],
    ['spinning_mill_ad', 'spinning_mill_doct'],
    ['weaving_workshop_ad', 'weaving_workshop_doct'],
    ['talent_garden_ad', 'talent_garden_doct'],
    ['clan_house_ad', 'clan_house_doct'],
    ['fair_ad', 'fair_doct'],
    ['mansion_ad', 'mansion_doct'],
    ['library_ad', 'library_doct'],
    ['storage_ad', 'storage_doct'],
    ['arena_ad', 'arena_doct'],
    ['spire_ad', 'spire_doct'],
    ['alcove_ad', 'alcove_doct'],
    ['temple_ad', 'temple_doct'],
    ['monument_ad', 'monument_doct'],
    ['tea_house_ad', 'tea_house_doct'],
    ['cat_house_ad', 'cat_house_doct'],
    ['dog_house_ad', 'dog_house_doct'],
    ['unicorn_house_ad', 'unicorn_house_doct'],
    ['scarlet_flower_ad', 'scarlet_flower_doct'],
    ['amber_flower_ad', 'amber_flower_doct'],
    ['signpost_ad', 'signpost_doct'],
    ['statue_ad', 'statue_doct'],
    ['drums_ad', 'drums_doct'],
    ['palm_with_bird_ad', 'palm_with_bird_doct'],
    ['fountain_ad', 'fountain_doct'],
    ['lantern_shop_ad', 'lantern_shop_doct'],
    ['crimson_bush_ad', 'crimson_bush_doct'],
    ['azure_bush_ad', 'azure_bush_doct'],
    ['crimson_inflorescence_ad', 'crimson_inflorescence_doct'],
    ['purple_inflorescence_ad', 'purple_inflorescence_doct'],
    ['hedge_ad', 'hedge_doct'],
    ['hedge_flowering_ad', 'hedge_flowering_doct'],
    ['hedge_flowering2_ad', 'hedge_flowering2_doct'],
    ['column_ad', 'column_doct'],
    ['flower_bed_ad', 'flower_bed_doct'],
    ['flower_bed2_ad', 'flower_bed2_doct'],
    ['flower_bed3_ad', 'flower_bed3_doct'],
    ['flower_bed4_ad', 'flower_bed4_doct'],
    ['small_tree_ad', 'small_tree_doct'],
    ['blooming_sakura_ad', 'blooming_sakura_doct'],
    ['bonsai_ad', 'bonsai_doct'],
    ['blooming_bonsai_ad', 'blooming_bonsai_doct'],
    ['reed_tower_ad', 'reed_tower_doct'],
    ['miniature_garden_ad', 'miniature_garden_doct'],
    ['big_sakura_ad', 'big_sakura_doct'],
    ['huge_cactus_ad', 'huge_cactus_doct'],
    ['rafflesia_ad', 'rafflesia_doct'],
    ['flytrap_ad', 'flytrap_doct'],
    ['figured_reed_ad', 'figured_reed_doct'],
    ['banana_palm_ad', 'banana_palm_doct'],
    ['coconut_palm_ad', 'coconut_palm_doct'],
    ['easel_ad', 'easel_doct'],
  ];

  // Категории в панели построек (View.renderCastleBuildingTypesToolbar) — вкладки оригинального замка
  // (ConstructionTab в ExportedSocialData): для героев, производство, развитие, услуги, декорации.
  // Осветители — своя вкладка: у Доктов «Фонарь», «Большой фонарь», у Адорнийцев светящиеся цветы,
  // у обеих «Лавка с фонарями».
  static lightingDecos = ['deco_0', 'deco_1', 'deco_7'];

  static buildingCategoryByName = {
    agility: 'heroes',
    cunning: 'heroes',
    health: 'heroes',
    intelligence: 'heroes',
    strength: 'heroes',
    tavern: 'heroes',

    crystal_farm: 'production',
    food_farm: 'production',
    heavy_farm: 'production',
    light_farm: 'production',
    silver_farm: 'production',
    talent_farm: 'production',

    clan_house: 'house',
    fair: 'house',
    house: 'house',
    library: 'house',
    storage: 'house',

    cat: 'services',
    dog: 'services',
    unicorn: 'services',
    easel: 'services',
  };

  // Здания первых четырёх вкладок (для героев, производство, развитие, услуги) — в одном экземпляре;
  // декорации и осветители можно ставить сколько угодно.
  static UNIQUE_BUILDING_CATEGORIES = ['heroes', 'production', 'house', 'services'];

  static isUniqueBuilding(id) {
    return Castle.UNIQUE_BUILDING_CATEGORIES.includes(Castle.getBuildingCategory(Castle.buildings[id]));
  }

  // здание уже стоит, едет за курсором или ждёт в панели, пока его поставят
  static isBuildingTaken(id) {
    const same = (b) => b && b.id == id;
    return Castle.placedBuildings.some(same) || Castle.pendingBuildings.some(same) || same(Castle.draggedBuilding?.building);
  }

  static isBuildingUnavailable(id) {
    return Castle.isUniqueBuilding(id) && Castle.isBuildingTaken(id);
  }

  // серым в панели построек — одиночные здания, которые уже стоят или ждут
  static updateBuildingItemsState() {
    document.querySelectorAll('.castle-building-item').forEach((item) => {
      const unavailable = Castle.isBuildingUnavailable(item.dataset.buildingId);
      item.classList.toggle('castle-building-item-taken', unavailable);
      if (unavailable) {
        item.dataset.tooltip = Lang.text('castleBuildingAlreadyBuilt');
        item.classList.remove('selectedBuild');
      } else {
        delete item.dataset.tooltip;
      }
    });
  }

  static getBuildingCategory(name) {
    if (Castle.lightingDecos.includes(name)) return 'lights';
    if (/^deco_/.test(name)) return 'decor';
    return Castle.buildingCategoryByName[name] || 'services';
  }

  static filter = RegExp('', '');

  static toggleMusic(layer, value) {
    Castle.music[layer] = value === undefined ? !Castle.music[layer] : Boolean(value);
    if (Castle.music.includes(false)) {
      Sound.pause('castle');
    } else {
      Sound.unpause('castle');
      Sound.setVolume('castle', Castle.GetVolume(Castle.AUDIO_MUSIC));
    }
  }

  static loopSleeping = false; // цикл отрисовки уснул, пока отрисовка выключена (loop)

  static toggleRender(layer, value) {
    Castle.render[layer] = value === undefined ? !Castle.render[layer] : Boolean(value);
    if (Castle.loopSleeping && !Castle.render.includes(false)) {
      Castle.loopSleeping = false;
      requestAnimationFrame(Castle.loop);
    }
  }

  static zoom(event) {
    if (Math.abs(Castle.currentFixedValue - Castle.targetFixedValue) > 0.04) {
      // camera animation is not finished
      return;
    }
    // Reset
    Castle.currentFixedValue = Castle.targetFixedValue;

    Castle.initialFixedValue = Castle.currentFixedValue;
    // Setup new target
    Castle.targetFixedValue = Castle.currentFixedValue + (event.deltaY > 0 ? -1 : +1);

    Castle.targetFixedValue = Castle.clamp(Castle.targetFixedValue, 0, Castle.fixedFovValues.length - 1);
  }

  static prepareMove(event) {
    if (!event || event.button !== 0) {
      return;
    }
    if (Castle.phantomBuilding.id == 0) {
      Castle.doMove = true;
    }
  }

  static stopMove(event) {
    if (event && event.button !== 0) {
      return;
    }
    Castle.doMove = false;
    setTimeout((_) => {
      Castle.wasMoved = false;
    }, 100);
  }

  static updateFilter(pattern, flags) {
    Castle.filter = RegExp(pattern, flags);
  }

  static moveMouse(event) {
    if (Castle.doMove) {
      Castle.cursorDeltaPos[0] = event.movementX * 2.0;

      Castle.cursorDeltaPos[1] = event.movementY * 2.0;

      if (Math.abs(event.movementX + event.movementY) > 0.1) {
        Castle.wasMoved = true;
      }
    } else {
      Castle.cursorDeltaPos[0] = 0;

      Castle.cursorDeltaPos[1] = 0;
    }

    Castle.cursorPosition[0] = event.offsetX;

    Castle.cursorPosition[1] = event.offsetY;

    if (Castle.dragCandidate) {
      if (!(event.buttons & 2)) {
        Castle.dragCandidate = null;
      } else if (
        Math.hypot(event.clientX - Castle.dragCandidate.startX, event.clientY - Castle.dragCandidate.startY) >=
        Castle.DRAG_START_THRESHOLD_PX
      ) {
        Castle.startBuildingDrag();
      }
    }
    if (Castle.draggedBuilding && !(event.buttons & 2)) {
      // ПКМ отпустили за пределами окна — mouseup мог не дойти
      Castle.finishBuildingDrag();
    }

    Castle.updatePhantomPosition();
  }

  static getBuildingSize(id) {
    return Castle.sceneBuildings[Castle.buildings[id]].size[0];
  }

  static updatePhantomPosition() {
    let shift = [Castle.gridTranslation[0], Castle.gridTranslation[1]];
    if (Castle.phantomBuilding.id > 0 && Castle.gridCursorPosX && Castle.gridCursorPosX) {
      const size = Castle.getBuildingSize(Castle.phantomBuilding.id);
      Castle.phantomBuilding.posX = Math.floor((shift[0] - Castle.gridCursorPosX) / 7.0 - size / 2.0);
      Castle.phantomBuilding.posY = Math.floor((shift[1] - Castle.gridCursorPosZ) / 7.0 - size / 2.0) + 17;
      Castle.phantomBuildingSize = size;

      Castle.dragSwapPlan = Castle.draggedBuilding ? Castle.planBuildingSwap() : null;
      Castle.phantomBuildingIsAllowedToBuild =
        Castle.dragSwapPlan !== null || Castle.isBuildingAllowed(Castle.phantomBuilding.posX, Castle.phantomBuilding.posY, size);
      Castle.UpdateGridImage();
    }
  }

  static isAreaOverlapping(aX, aY, aSize, bX, bY, bSize) {
    return aX < bX + bSize && bX < aX + aSize && aY < bY + bSize && bY < aY + aSize;
  }

  static getOverlappingBuildings(posX, posY, size) {
    return Castle.placedBuildings.filter((b) => Castle.isAreaOverlapping(posX, posY, size, b.posX, b.posY, Castle.getBuildingSize(b.id)));
  }

  // свободно ли место, если не считать зданий из ignore и с учётом занятых мест из reserved ([{posX, posY, size}])
  static isAreaFreeFor(posX, posY, size, ignore = [], reserved = []) {
    if (!Castle.isInsideBuildZone(posX, posY, size)) {
      return false;
    }
    for (const r of reserved) {
      if (Castle.isAreaOverlapping(posX, posY, size, r.posX, r.posY, r.size)) {
        return false;
      }
    }
    return Castle.getOverlappingBuildings(posX, posY, size).every((b) => ignore.includes(b));
  }

  // Обмен местами: перетаскиваемое здание кладут поверх других — вытеснить можно сразу несколько.
  // Вытесненные переезжают на освободившееся место, сохраняя взаимное расположение (если не влезают так —
  // по центру, в угол или в любую свободную точку старого места); кому места не хватило — ждут в панели.
  static planBuildingSwap() {
    const dragged = Castle.draggedBuilding;
    const size = Castle.getBuildingSize(dragged.building.id);
    // здание стоит ровно там, где курсор, — к зданиям под ним не притягивается
    const pos = [Castle.phantomBuilding.posX, Castle.phantomBuilding.posY];
    if (!Castle.isInsideBuildZone(pos[0], pos[1], size) || !Castle.getOverlappingBuildings(pos[0], pos[1], size).length) {
      return null;
    }
    // крупные — первыми: им труднее найти место
    const targets = Castle.getOverlappingBuildings(pos[0], pos[1], size).sort(
      (a, b) => Castle.getBuildingSize(b.id) - Castle.getBuildingSize(a.id),
    );
    const reserved = [{ posX: pos[0], posY: pos[1], size: size }];
    const moves = targets.map((target) => {
      const targetSize = Castle.getBuildingSize(target.id);
      const keep = [dragged.origX + (target.posX - pos[0]), dragged.origY + (target.posY - pos[1])];
      const centerOffset = Math.floor((size - targetSize) / 2);
      const spots = [];
      for (let x = dragged.origX; x <= dragged.origX + size - targetSize; ++x) {
        for (let y = dragged.origY; y <= dragged.origY + size - targetSize; ++y) {
          spots.push([x, y]);
        }
      }
      spots.sort((a, b) => Math.hypot(a[0] - keep[0], a[1] - keep[1]) - Math.hypot(b[0] - keep[0], b[1] - keep[1]));
      const free =
        [keep, [dragged.origX + centerOffset, dragged.origY + centerOffset], [dragged.origX, dragged.origY], ...spots].find(([x, y]) =>
          Castle.isAreaFreeFor(x, y, targetSize, targets, reserved),
        ) || null;
      if (free) {
        reserved.push({ posX: free[0], posY: free[1], size: targetSize });
      }
      return { building: target, pos: free };
    });
    return { posX: pos[0], posY: pos[1], moves: moves };
  }

  static selectPhantomBuilding(id) {
    if (Castle.draggedBuilding) {
      Castle.playErrorSound();
      return false;
    }
    if (Castle.isBuildingUnavailable(id)) {
      Castle.playErrorSound();
      return false;
    }
    // взятое из панели ожидающее здание остаётся ждать в ней
    Castle.setPlacingPending(null);
    Castle.phantomBuilding.id = id;
    Castle.phantomBuilding.rot = 0;
    Castle.updatePhantomPosition();
    return true;
  }

  static resetPhantomBuilding() {
    Castle.phantomBuilding.id = 0;
    Castle.phantomBuilding.rot = 0;
    Castle.phantomBuilding.posX = 0;
    Castle.phantomBuilding.posY = 1000;
    Castle.dragSwapPlan = null;
    Castle.UpdateGridImage();
  }

  static playErrorSound() {
    Sound.play(SOUNDS_LIBRARY.ERROR, {
      id: 'ui-error',
      volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) * 0.25,
    });
  }

  static onBuildingMouseDown(event) {
    if (!event || event.button !== 2) {
      return;
    }
    Castle.suppressContextMenu = false;
    Castle.dragCandidate = null;
    if (!Castle.buildMode || Castle.phantomBuilding.id > 0 || !Castle.outlinedBuilding) {
      return;
    }
    const [posX, posY] = Castle.outlinedBuilding.position;
    const building = Castle.placedBuildings.find((b) => b.posX == posX && b.posY == posY);
    if (building) {
      Castle.dragCandidate = { building: building, startX: event.clientX, startY: event.clientY };
    }
  }

  static onBuildingMouseUp(event) {
    if (!event || event.button !== 2) {
      return;
    }
    Castle.dragCandidate = null;
    if (Castle.draggedBuilding) {
      Castle.finishBuildingDrag();
      // после перетаскивания ПКМ не должен снести здание
      Castle.suppressContextMenu = true;
    }
  }

  static startBuildingDrag() {
    const building = Castle.dragCandidate.building;
    Castle.dragCandidate = null;
    const index = Castle.placedBuildings.indexOf(building);
    if (index < 0) {
      return;
    }
    // расстановка до перестановки — для отмены, если здание действительно переедет
    const undoSnapshot = Castle.snapshotBuildings();
    Castle.placedBuildings.splice(index, 1);
    Castle.draggedBuilding = { building: building, origX: building.posX, origY: building.posY, undoSnapshot: undoSnapshot };
    Castle.phantomBuilding.id = building.id;
    Castle.phantomBuilding.rot = building.rot;
    Castle.UpdateAllowedToBuildGrid();
    Castle.isStaticSMCached = false;
    Castle.updatePhantomPosition();
    Sound.play(SOUNDS_LIBRARY.CLICK_BUTTON_PRESS_SMALL, { volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) });
  }

  static finishBuildingDrag() {
    const dragged = Castle.draggedBuilding;
    if (!dragged) {
      return;
    }
    Castle.updatePhantomPosition();
    const building = dragged.building;
    const plan = Castle.dragSwapPlan;
    const pending = [];
    let moved = true;
    const undoSnapshot = dragged.undoSnapshot;
    if (plan) {
      building.posX = plan.posX;
      building.posY = plan.posY;
      for (const move of plan.moves) {
        if (move.pos) {
          move.building.posX = move.pos[0];
          move.building.posY = move.pos[1];
        } else {
          Castle.placedBuildings.splice(Castle.placedBuildings.indexOf(move.building), 1);
          pending.push(move.building);
        }
      }
    } else if (Castle.phantomBuildingIsAllowedToBuild) {
      building.posX = Castle.phantomBuilding.posX;
      building.posY = Castle.phantomBuilding.posY;
    } else {
      building.posX = dragged.origX;
      building.posY = dragged.origY;
      moved = false;
    }
    Castle.placedBuildings.push(building);
    Castle.draggedBuilding = null;
    if (moved) {
      Castle.pushUndo(undoSnapshot);
    }
    Castle.resetPhantomBuilding();
    if (pending.length) {
      Castle.pendingBuildings.push(...pending);
      Castle.renderPendingTray();
    }
    Castle.isStaticSMCached = false;
    Castle.WriteBuildings();
    Castle.updatePhantomPosition();
    if (moved) {
      Sound.play(SOUNDS_LIBRARY.BUY, {
        id: 'ui-buy',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
      });
    } else {
      Castle.playErrorSound();
    }
  }

  static cancelBuildInteraction() {
    Castle.dragCandidate = null;
    if (Castle.draggedBuilding) {
      const { building, origX, origY } = Castle.draggedBuilding;
      building.posX = origX;
      building.posY = origY;
      Castle.placedBuildings.push(building);
      Castle.draggedBuilding = null;
      Castle.isStaticSMCached = false;
      Castle.WriteBuildings();
    }
    // ожидающие здания уже убраны из placedBuildings — просто забываем их; отменять больше нечего
    Castle.pendingBuildings = [];
    Castle.undoStack = [];
    Castle.placingPending = null;
    Castle.renderPendingTray();
    Castle.resetPhantomBuilding();
    document.querySelectorAll('.castle-building-item').forEach((item) => {
      item.classList.remove('selectedBuild');
    });
  }

  static snapshotBuildings() {
    return {
      placed: Castle.placedBuildings.map((b) => ({ ...b })),
      pending: Castle.pendingBuildings.map((b) => ({ ...b })),
    };
  }

  static pushUndo(snapshot = Castle.snapshotBuildings()) {
    Castle.undoStack.push(snapshot);
    if (Castle.undoStack.length > Castle.UNDO_LIMIT) {
      Castle.undoStack.shift();
    }
  }

  static undoBuildAction() {
    const snapshot = Castle.draggedBuilding ? null : Castle.undoStack.pop();
    if (!Castle.buildMode || !snapshot) {
      Castle.playErrorSound();
      return;
    }
    Castle.dragCandidate = null;
    Castle.placingPending = null;
    Castle.placedBuildings = snapshot.placed;
    Castle.pendingBuildings = snapshot.pending;
    Castle.resetPhantomBuilding();
    document.querySelectorAll('.castle-building-item').forEach((item) => {
      item.classList.remove('selectedBuild');
    });
    Castle.isStaticSMCached = false;
    Castle.WriteBuildings();
    Castle.renderPendingTray();
    Sound.play(SOUNDS_LIBRARY.CLICK_BUTTON_PRESS_SMALL, { volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) });
  }

  // Ctrl+Z — если его не занял глобальный хоткей войса (по умолчанию он как раз Ctrl+Z)
  static isUndoHotkeyFree() {
    return NativeAPI.voiceShortcut?.key !== 'Ctrl+Z';
  }

  static onUndoKeyDown(event) {
    if (!Castle.buildMode || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.code !== 'KeyZ') {
      return;
    }
    const target = event.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
      return;
    }
    event.preventDefault();
    Castle.undoBuildAction();
  }

  // взять ожидающее здание из панели (null — вернуть в панель то, что сейчас ставится)
  static setPlacingPending(building) {
    if (!building && !Castle.placingPending) {
      return;
    }
    if (building) {
      if (Castle.draggedBuilding || !Castle.pendingBuildings.includes(building)) {
        Castle.playErrorSound();
        return;
      }
      document.querySelectorAll('.castle-building-item').forEach((item) => {
        item.classList.remove('selectedBuild');
      });
      Castle.placingPending = building;
      Castle.phantomBuilding.id = building.id;
      Castle.phantomBuilding.rot = building.rot;
      Castle.updatePhantomPosition();
    } else {
      Castle.placingPending = null;
      Castle.resetPhantomBuilding();
    }
    Castle.renderPendingTray();
  }

  static renderPendingTray() {
    Castle.updateBuildingItemsState();
    const tray = Castle.pendingTray;
    if (!tray) {
      return;
    }
    tray.replaceChildren();
    tray.style.display = Castle.buildMode ? '' : 'none';
    if (!Castle.buildMode) {
      return;
    }
    const canUndo = Castle.undoStack.length > 0;
    tray.append(
      DOM(
        {
          style: ['castle-build-undo', ...(canUndo ? [] : ['castle-build-undo-disabled'])],
          domaudio: domAudioPresets.defaultButton,
          data: {
            tooltip: Lang.text('castleBuildUndoTooltip') + (Castle.isUndoHotkeyFree() ? ' (Ctrl+Z)' : ''),
          },
          event: ['click', () => Castle.undoBuildAction()],
        },
        Lang.text('castleBuildUndo'),
      ),
    );
    if (!Castle.pendingBuildings.length) {
      return;
    }
    tray.append(DOM({ style: 'castle-pending-buildings-title' }, Lang.text('castlePendingBuildingsTitle')));
    const list = DOM({ style: 'castle-pending-buildings-list' });
    for (const building of Castle.pendingBuildings) {
      const name = Castle.buildings[building.id];
      const item = DOM(
        {
          style: ['castle-pending-building', ...(building === Castle.placingPending ? ['castle-pending-building-active'] : [])],
          domaudio: domAudioPresets.defaultButton,
          data: { tooltip: Lang.text('castlePendingBuildingTooltip') },
          event: ['click', () => Castle.setPlacingPending(building === Castle.placingPending ? null : building)],
        },
        DOM({ tag: 'img', src: `content/img/buildings/${Castle.currentSceneName}/${name}.png` }),
      );
      list.append(item);
    }
    tray.append(list);
  }

  static isBuildingAllowed(posX, posY, size) {
    if (!Castle.isInsideBuildZone(posX, posY, size)) {
      return false;
    }
    for (let i = 0; i < size; ++i) {
      for (let j = 0; j < size; ++j) {
        if (Castle.allowedToBuildGrid[posX + i][posY + j]) {
          return false;
        }
      }
    }
    return true;
  }

  static isInsideBuildZone(posX, posY, size) {
    const posXMax = posX + size - 1;
    const posYMax = posY + size - 1;
    if (posX < 0 || posY < 0) {
      return false;
    }
    if (posXMax > 45 || posYMax > 37) {
      return false;
    }
    // Castle zone
    if (posX < 31 && posY < 3) {
      return false;
    }
    if (posX < 23 && posY < 8) {
      return false;
    }
    if (posX < 22 && posY < 14) {
      return false;
    }
    if (posX < 18 && posY < 17) {
      return false;
    }
    if (posXMax > 9 && posX < 18 && posY == 17) {
      return false;
    }
    // Bottom corner
    if (posXMax > 28 || posYMax > 20) {
      if (45 - posYMax + 37 - posXMax < 17) {
        return false;
      }
    }
    // Left corner
    if (posXMax > 43 || posY < 2) {
      if (45 - posXMax + posY < 2) {
        return false;
      }
    }
    // Right corner
    if (posX < 2 || posYMax > 35) {
      if (posX + 37 - posYMax < 2) {
        return false;
      }
    }
    return true;
  }

  // Цвета клеток сетки строительства (RGBA): зелёный — можно, красный — нельзя, жёлтый — занято.
  // Клетки ставящегося здания рисуются поверх занятых.
  // насколько сетка строительства приподнята над землёй, чтобы её не закрывали дорожки, камни и трава
  static GRID_LIFT = 8;
  static GRID_CELL_OCCUPIED = [255, 200, 0, 170];
  static GRID_CELL_PHANTOM_GOOD = [40, 255, 60, 255];
  static GRID_CELL_PHANTOM_BAD = [255, 20, 20, 255];
  static GRID_CELL_SWAP_TARGET = [0, 200, 255, 255]; // здание, на которое кладут, и куда оно переедет
  static GRID_CELL_SWAP_PENDING = [210, 90, 255, 255]; // ему не хватит места — будет ждать в панели

  static UpdateGridImage() {
    const data = Castle.allowedToBuildGridTex;
    const ids = Castle.gridIdTex;
    const phantom = Castle.phantomBuilding;
    const phantomSize = Castle.phantomBuildingSize;
    const plan = Castle.dragSwapPlan;
    const moves = plan ? plan.moves.map((move) => ({ ...move, size: Castle.getBuildingSize(move.building.id) })) : [];
    const inArea = (x, y, areaX, areaY, size) => x >= areaX && y >= areaY && x < areaX + size && y < areaY + size;
    for (let i = 0; i < data.length / 4; ++i) {
      const posX = i % 64;
      const posY = Math.floor(i / 64);
      let color = null;
      let id = 0;
      if (posX < 47 && posY < 38) {
        if (Castle.allowedToBuildGrid[posX][posY]) {
          color = Castle.GRID_CELL_OCCUPIED;
          id = Castle.allowedToBuildGrid[posX][posY];
        }
        moves.forEach((move, m) => {
          if (inArea(posX, posY, move.building.posX, move.building.posY, move.size)) {
            color = move.pos ? Castle.GRID_CELL_SWAP_TARGET : Castle.GRID_CELL_SWAP_PENDING;
          } else if (move.pos && inArea(posX, posY, move.pos[0], move.pos[1], move.size)) {
            color = Castle.GRID_CELL_SWAP_TARGET;
            id = Castle.GRID_ID_MOVE_BASE + m;
          }
        });
        if (phantom.id && inArea(posX, posY, phantom.posX, phantom.posY, phantomSize)) {
          color = Castle.phantomBuildingIsAllowedToBuild ? Castle.GRID_CELL_PHANTOM_GOOD : Castle.GRID_CELL_PHANTOM_BAD;
          id = Castle.GRID_ID_PHANTOM;
        }
      }
      data.set(color || [0, 0, 0, 0], i * 4);
      ids[i * 4] = id & 255;
      ids[i * 4 + 1] = id >> 8;
    }
  }

  static UpdateAllowedToBuildGrid() {
    Castle.allowedToBuildGrid = Array.from(Array(47), () => new Array(38));
    Castle.placedBuildings.forEach((placedBuilding, index) => {
      const pbSize = Castle.sceneBuildings[Castle.buildings[placedBuilding.id]].size[0];
      for (let i = 0; i < pbSize; ++i) {
        for (let j = 0; j < pbSize; ++j) {
          Castle.allowedToBuildGrid[placedBuilding.posX + i][placedBuilding.posY + j] = index + 1;
        }
      }
    });
    Castle.UpdateGridImage();
  }

  static placePhantomBuilding() {
    if (Castle.phantomBuildingIsAllowedToBuild) {
      Castle.pushUndo();
      if (Castle.placingPending) {
        // вытесненное здание ставят обратно — то же самое здание, а не новое
        const pending = Castle.placingPending;
        pending.posX = Castle.phantomBuilding.posX;
        pending.posY = Castle.phantomBuilding.posY;
        Castle.placedBuildings.push(pending);
        Castle.pendingBuildings.splice(Castle.pendingBuildings.indexOf(pending), 1);
        Castle.placingPending = null;
        Castle.resetPhantomBuilding();
        Castle.renderPendingTray();
      } else {
        Castle.placedBuildings.push(Object.assign({}, Castle.phantomBuilding));
        // одиночное здание второй раз не поставить — снимаем его с курсора
        if (Castle.isUniqueBuilding(Castle.phantomBuilding.id)) {
          Castle.resetPhantomBuilding();
        }
      }
      Castle.isStaticSMCached = false;
      Castle.WriteBuildings();
      Sound.play(SOUNDS_LIBRARY.BUY, {
        id: 'ui-buy',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
      });
    } else {
      Sound.play(SOUNDS_LIBRARY.ERROR, {
        id: 'ui-error',
        volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) * 0.25,
      });
    }
  }

  static findAndRotateBuilding(posX, posY) {
    for (let b = 0; b < Castle.placedBuildings.length; ++b) {
      let building = Castle.placedBuildings[b];
      if (building.posX == posX && building.posY == posY) {
        Castle.pushUndo();
        building.rot = (building.rot + 1) % 4;
        Castle.isStaticSMCached = false;
        Castle.WriteBuildings();
        Sound.play(SOUNDS_LIBRARY.CLICK_BUTTON_PRESS_SMALL, { volume: Castle.GetVolume(Castle.AUDIO_SOUNDS) });
        return;
      }
    }
  }

  static findAndDeleteBuilding(posX, posY) {
    for (let b = 0; b < Castle.placedBuildings.length; ++b) {
      let building = Castle.placedBuildings[b];
      if (building.posX == posX && building.posY == posY) {
        Castle.pushUndo();
        Castle.placedBuildings.splice(b, 1);
        Castle.isStaticSMCached = false;
        Castle.WriteBuildings();
        Sound.play(SOUNDS_LIBRARY.BUY, {
          id: 'ui-buy',
          volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
        });
        return;
      }
    }
  }

  static GetLauncherFilePath(fileName) {
    const homeDir = NativeAPI.os.homedir();
    let pwcLauncherDir = NativeAPI.path.join(homeDir, 'Prime World Classic');
    return NativeAPI.path.join(pwcLauncherDir, fileName);
  }

  static async ensureCastleFile() {
    const homeDir = NativeAPI.os.homedir();
    let pwcLauncherDir = NativeAPI.path.join(homeDir, 'Prime World Classic');
    let castleFilePath = Castle.GetLauncherFilePath('castle.cfg');
    try {
      await NativeAPI.fileSystem.promises.mkdir(pwcLauncherDir, {
        recursive: true,
      });
      await NativeAPI.fileSystem.promises.access(castleFilePath);
      return true;
    } catch (e) {
      await Castle.WriteDefaultBuildings();
      return false;
    }
  }

  static async WriteDefaultBuildings() {
    Castle.placedBuildings = JSON.parse(JSON.stringify(Castle.defaultPlacedBuildings));
    await Castle.WriteBuildings();
  }

  static async ReadBuildings() {
    if (!NativeAPI.status) {
      Castle.placedBuildings = Castle.defaultPlacedBuildings;
      Castle.UpdateAllowedToBuildGrid();
      return;
    }

    let castleFilePath = Castle.GetLauncherFilePath('castle.cfg');
    try {
      if (await Castle.ensureCastleFile()) {
        const data = await NativeAPI.fileSystem.promises.readFile(castleFilePath, 'utf-8');
        Castle.placedBuildings = JSON.parse(data);
      }
    } catch (e) {
      Castle.placedBuildings = Castle.defaultPlacedBuildings;
    }
    Castle.UpdateAllowedToBuildGrid();
  }

  static async WriteBuildings() {
    Castle.renderPendingTray();
    if (!NativeAPI.status) {
      Castle.UpdateAllowedToBuildGrid();
      return;
    }

    let castleFilePath = Castle.GetLauncherFilePath('castle.cfg');
    try {
      await NativeAPI.fileSystem.promises.writeFile(castleFilePath, JSON.stringify(Castle.placedBuildings, null, 2), 'utf-8');
    } catch (e) {
      App.error(e);
    }
    Castle.UpdateAllowedToBuildGrid();
  }

  static async loadBuildings() {
    await Castle.ReadBuildings();
    Castle.isBuildingsLoaded = true;

    window.addEventListener('beforeunload', () => {
      Castle.WriteBuildings();
    });
  }

  static async initDemo(sceneName, canvas, options = {}) {
    Castle.currentSceneName = sceneName;

    Castle.shaderFactionDef = sceneName == 'doct' ? 'SCENE_DOCT' : 'SCENE_AD';

    window.addEventListener(
      'resize',
      function (event) {
        canvas.width = document.body.offsetWidth;

        canvas.height = document.body.offsetHeight;

        Castle.canvasWidth = canvas.width;

        Castle.canvasHeight = canvas.height;

        Castle.cursorPosition = [Castle.canvasWidth, Castle.canvasHeight];
      },
      true,
    );

    canvas.addEventListener('click', function (event) {
      if (Castle.phantomBuilding.id > 0) {
        Castle.placePhantomBuilding();
      } else {
        if (Castle.outlinedBuilding && !Castle.wasMoved) {
          if (Castle.buildMode) {
            Castle.findAndRotateBuilding(Castle.outlinedBuilding.position[0], Castle.outlinedBuilding.position[1]);
          } else {
            if (Castle.outlinedBuilding.name in CastleBuildingsEvents) {
              Sound.play(SOUNDS_LIBRARY.CLICK_OPEN_BIG, {
                id: 'ui-big-click',
                volume: Castle.GetVolume(Castle.AUDIO_SOUNDS),
              });
              CastleBuildingsEvents[Castle.outlinedBuilding.name]();
            }
          }
        }
      }
    });

    Castle.globalCanvas = canvas;

    canvas.onwheel = Castle.zoom;

    //var canvas = document.getElementById('game-surface');

    canvas.width = document.body.offsetWidth;

    canvas.height = document.body.offsetHeight;

    canvas.onmousedown = Castle.prepareMove;

    canvas.onmouseup = Castle.stopMove;

    if (!options.preview) {
      // перемещение зданий зажатым ПКМ; отпускание ловим на window — курсор мог уйти с холста
      canvas.addEventListener('mousedown', Castle.onBuildingMouseDown);
      window.addEventListener('mouseup', Castle.onBuildingMouseUp);
      window.addEventListener('keydown', Castle.onUndoKeyDown);
    }

    if (!options.preview) oncontextmenu = (event) => {
      event.preventDefault();
      if (Castle.suppressContextMenu) {
        Castle.suppressContextMenu = false;
        return;
      }
      // здание едет за курсором — ПКМ его не отменяет
      if (Castle.draggedBuilding) {
        return;
      }
      // ожидающее здание, взятое из панели, ПКМ возвращает в панель
      if (Castle.placingPending) {
        Castle.setPlacingPending(null);
        return;
      }
      Castle.resetPhantomBuilding();
      document.querySelectorAll('.castle-building-item').forEach((item) => {
        item.classList.remove('selectedBuild');
      });

      if (Castle.buildMode && Castle.outlinedBuilding) {
        Castle.findAndDeleteBuilding(Castle.outlinedBuilding.position[0], Castle.outlinedBuilding.position[1]);
      }
    };

    canvas.addEventListener('mousemove', Castle.moveMouse);

    Castle.gl = canvas.getContext('webgl');

    if (!Castle.gl) {
      console.log('WebGL not supported, falling back on experimental-webgl');
      Castle.gl = canvas.getContext('experimental-webgl');
    }

    if (!Castle.gl) {
      console.error('Your browser does not support WebGL');
      return 1;
    }

    Castle.gl.enable(Castle.gl.DEPTH_TEST);
    Castle.gl.enable(Castle.gl.CULL_FACE);
    Castle.gl.frontFace(Castle.gl.CCW);
    Castle.gl.cullFace(Castle.gl.FRONT);

    Castle.viewMatrix = new Float32Array(16);
    Castle.viewMatrix2 = new Float32Array(16);
    Castle.projMatrix = new Float32Array(16);
    Castle.viewProjMatr = new Float32Array(16);
    Castle.flipMatr = new Float32Array([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    Castle.canvasWidth = canvas.width;
    Castle.canvasHeight = canvas.height;
    Castle.cursorPosition = [Castle.canvasWidth, Castle.canvasHeight];

    Castle.isSMEnabled = true;

    // отложенное освещение (точечные источники зданий) — до загрузки шейдеров: от него зависит PSO_GB
    CastleLighting.init(Castle.gl);

    const ext = Castle.gl.getExtension('WEBGL_depth_texture');

    if (!ext) {
      Castle.isSMEnabled = false;
    }

    if (Castle.isSMEnabled) {
      Castle.setupLightMatrix(sceneName);

      Castle.gridTexture = Castle.gl.createTexture();
      Castle.gl.bindTexture(Castle.gl.TEXTURE_2D, Castle.gridTexture);
      Castle.gl.texImage2D(
        Castle.gl.TEXTURE_2D, // target
        0, // mip level
        Castle.gl.RGBA, // internal format
        64, // width
        64, // height
        0, // border
        Castle.gl.RGBA,
        Castle.gl.UNSIGNED_BYTE,
        null,
      ); // data
      Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_MAG_FILTER, Castle.gl.NEAREST);
      Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_MIN_FILTER, Castle.gl.NEAREST);
      Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_WRAP_S, Castle.gl.CLAMP_TO_EDGE);
      Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_WRAP_T, Castle.gl.CLAMP_TO_EDGE);

      Castle.gridIdTexture = Castle.gl.createTexture();
      Castle.gl.bindTexture(Castle.gl.TEXTURE_2D, Castle.gridIdTexture);
      Castle.gl.texImage2D(Castle.gl.TEXTURE_2D, 0, Castle.gl.RGBA, 64, 64, 0, Castle.gl.RGBA, Castle.gl.UNSIGNED_BYTE, null);
      Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_MAG_FILTER, Castle.gl.NEAREST);
      Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_MIN_FILTER, Castle.gl.NEAREST);
      Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_WRAP_S, Castle.gl.CLAMP_TO_EDGE);
      Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_WRAP_T, Castle.gl.CLAMP_TO_EDGE);

      // Setup textures
      Castle.depthTexture = Castle.gl.createTexture();
      Castle.gl.bindTexture(Castle.gl.TEXTURE_2D, Castle.depthTexture);
      Castle.gl.texImage2D(
        Castle.gl.TEXTURE_2D, // target
        0, // mip level
        Castle.gl.DEPTH_COMPONENT, // internal format
        Castle.depthTextureSize, // width
        Castle.depthTextureSize, // height
        0, // border
        Castle.gl.DEPTH_COMPONENT, // format
        Castle.gl.UNSIGNED_INT, // type
        null,
      ); // data
      Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_MAG_FILTER, Castle.gl.NEAREST);
      Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_MIN_FILTER, Castle.gl.NEAREST);
      Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_WRAP_S, Castle.gl.REPEAT);
      Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_WRAP_T, Castle.gl.REPEAT);

      Castle.depthFramebuffer = Castle.gl.createFramebuffer();
      Castle.gl.bindFramebuffer(Castle.gl.FRAMEBUFFER, Castle.depthFramebuffer);
      Castle.gl.framebufferTexture2D(
        Castle.gl.FRAMEBUFFER, // target
        Castle.gl.DEPTH_ATTACHMENT, // attachment point
        Castle.gl.TEXTURE_2D, // texture target
        Castle.depthTexture, // texture
        0,
      ); // mip level

      const unusedTexture = Castle.gl.createTexture();
      Castle.smColorTexture = unusedTexture;
      Castle.gl.bindTexture(Castle.gl.TEXTURE_2D, unusedTexture);
      Castle.gl.texImage2D(
        Castle.gl.TEXTURE_2D,
        0,
        Castle.gl.RGBA,
        Castle.depthTextureSize,
        Castle.depthTextureSize,
        0,
        Castle.gl.RGBA,
        Castle.gl.UNSIGNED_BYTE,
        null,
      );
      Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_MAG_FILTER, Castle.gl.NEAREST);
      Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_MIN_FILTER, Castle.gl.NEAREST);
      Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_WRAP_S, Castle.gl.REPEAT);
      Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_WRAP_T, Castle.gl.REPEAT);

      // attach it to the framebuffer
      Castle.gl.framebufferTexture2D(
        Castle.gl.FRAMEBUFFER, // target
        Castle.gl.COLOR_ATTACHMENT0, // attachment point
        Castle.gl.TEXTURE_2D, // texture target
        unusedTexture, // texture
        0,
      ); // mip level
    }

    await Castle.loadScene(sceneName);

    //var canvas = globalCanvas; //document.getElementById('game-surface');

    Castle.globalCanvas.classList.add('castle-fade-in');

    if (!options.preview && !('castle' in Sound.all)) {
      Castle.startCastleMusic(sceneName);
    }

    if (options.preview) {
      Castle.placedBuildings = structuredClone(Castle.defaultPlacedBuildings);
      Castle.UpdateAllowedToBuildGrid();
      Castle.isBuildingsLoaded = true;
    } else {
      Castle.loadBuildings();
    }

    Castle.MainLoop(Castle.sceneObjects, Castle.sceneBuildings, Castle.sceneShaders, Castle.sceneTextures);
  }

  // Матрица источника света для карты теней зависит от сцены (фракции).
  static setupLightMatrix(sceneName) {
    // Setup matrix. Only one viewProj is needed
    let lightViewMatrix = new Float32Array(16);
    let lightViewMatrix2 = new Float32Array(16);
    let lightProjMatrix = new Float32Array(16);
    Castle.lightViewProjMatrix = new Float32Array(16);
    mat4.ortho(lightProjMatrix, -400, 400, -400, 400, Castle.zNearSM, Castle.zFarSM);

    let smCamParams = [
      {
        name: 'ad',
        camPos: [-1239.6, -151, -1433],
        camRot: [-2.29, 2.813, 3.14],
      },
      {
        name: 'doct',
        camPos: [-1395.8, -291.7, -1338.5],
        camRot: [-2.4, -1.423, 3.14],
      },
    ];

    let quatStart = quat.create();
    quat.identity(quatStart);
    let quatX = quat.create();
    let quatY = quat.create();
    let quatZ = quat.create();

    let smCam = smCamParams.find((value) => value.name === sceneName);
    quat.rotateX(quatX, quatStart, smCam.camRot[0]);
    quat.rotateY(quatY, quatX, smCam.camRot[1]);
    quat.rotateZ(quatZ, quatY, smCam.camRot[2]);

    mat4.fromRotationTranslation(lightViewMatrix, quatZ, vec3.create());
    mat4.translate(lightViewMatrix, lightViewMatrix, smCam.camPos);
    mat4.multiply(lightViewMatrix2, Castle.flipMatr, lightViewMatrix);
    mat4.multiply(Castle.lightViewProjMatrix, lightProjMatrix, lightViewMatrix2);

    // Центр, вокруг которого ходит солнце, — не точка исходной камеры теней (она висит высоко и смещена,
    // при повороте солнца карта теней уезжала с замка и тени обрывались по прямой), а земля под
    // видимой частью замка. Камера замка у обеих фракций одна, центр общий. Подобран замером
    // (Castle.shadowCoverageReport): вне карты теней 0-0.2% кадра в обычных видах в любое время суток.
    Castle.smCenter = Castle.sunShadowCenter.slice();
    // Для движущегося солнца камера теней дальше и глубже исходной: при низком солнце далёкие
    // холмы иначе резались ближней плоскостью, и их тень обрывалась ползущей прямой линией.
    const ext = Castle.sunShadowExtent;
    Castle.smProj = mat4.ortho(mat4.create(), -ext, ext, -ext, ext, Castle.zNearSM, Castle.sunZFar);
    Castle.sunDirForSM = null;
    Castle.camAxes = null;
  }

  // ---- Смена дня и ночи --------------------------------------------------------------------
  // Ускоренные сутки по общему времени (у всех игроков одинаково): солнце восходит справа от
  // камеры, проходит высоко у неё за спиной (в кадр не попадает) и садится слева. Тени идут
  // за солнцем (карта теней пересчитывается при сдвиге солнца), ночью яркость ~25% дневной.
  static dayCycleSeconds = 20 * 60;
  static dayShare = 0.75; // доля суток, когда солнце над горизонтом: 15 мин день, 5 мин ночь
  static sunMaxElevationDeg = 55;
  static sunMinShadowElevationDeg = 30;
  static nightExposure = 0.8; // средняя яркость ночью ~25% дневной (замерено по кадру)
  static dayTimeOverride = null; // 0..1 — зафиксировать время суток (отладка)
  // Кнопка времени суток у списка внизу (View): смена дня и ночи / всегда день / всегда ночь
  static DAY_MODES = ['cycle', 'day', 'night'];
  static dayModeTime = { day: 0.3, night: 0.875 }; // доля суток: утреннее солнце / середина ночи

  static get dayMode() {
    const mode = Settings.settings?.dayNightMode;
    return Castle.DAY_MODES.includes(mode) ? mode : 'cycle';
  }

  static nextDayMode() {
    const modes = Castle.DAY_MODES;
    const mode = modes[(modes.indexOf(Castle.dayMode) + 1) % modes.length];
    if (Settings.settings) Settings.settings.dayNightMode = mode;
    Settings.WriteSettings?.().catch?.(() => {});
    return mode;
  }
  static sunLight = [1, 1, 1, 1]; // rgb — цвет и сила солнца, a — экспозиция
  // a — смещение глубины теней (исходно 0.001; для солнца со смены дня и ночи камера теней глубже — 0.0004)
  static ambientLight = [1, 1, 1, 0.001];
  static lighting = CastleLighting; // для отладки из консоли: Castle.lighting.debugMarkers = true
  static fireflies = CastleFireflies;
  static glowNightFloor = 1.0; // яркость свечений ночью (множитель освещения, днём на солнце ~1.6)
  static deferredPass = false;
  static sceneTextureAvg = [];
  static dayNightActive = false;
  static daylight = 1; // 0 ночью, 1 днём (Castle.updateDayNight)
  static smCenter = null;
  static sunDist = 1500;
  static sunZFar = 3000;
  static sunShadowCenter = [1170, 27, 1230];
  static sunShadowExtent = 550; // ±550: 7.4 текселя карты теней на единицу (исходно ±400)
  static smProj = null;
  static sunDirForSM = null;
  static sunSMUpdatedAt = 0;
  static smUpdateIntervalMs = 500;
  static camAxes = null;

  // ---- Отладка теней -----------------------------------------------------------------------
  // В проходе теней каждый объект пишет свой номер (debugId) в цветовое вложение карты теней.
  // Castle.setShadowDebug(1) — тени окрашены цветом отбросившего их объекта;
  // Castle.setShadowDebug(2) — затенённые пиксели выводятся кодом объекта, отчёт: shadowDebugReport().
  static shadowDebugMode = 0;
  static smColorTexture = null;
  static debugObjects = [];
  static currentDrawObject = null;

  static setShadowDebug(mode = 1) {
    Castle.shadowDebugMode = Number(mode) || 0;
    Castle.isStaticSMCached = false;
  }

  // Какие объекты отбрасывают тень в текущем кадре и на сколько пикселей экрана (режим 2).
  static shadowDebugReport(top = 15) {
    const gl = Castle.gl;
    const prev = Castle.shadowDebugMode;
    Castle.shadowDebugMode = 2;
    Castle.isStaticSMCached = false;
    Castle.loop();
    const w = gl.drawingBufferWidth,
      h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    Castle.shadowDebugMode = prev;
    const counts = new Map();
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 2] !== 255) continue;
      const id = px[i] | (px[i + 1] << 8);
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([id, n]) => ({ id, mesh: Castle.debugObjects[id - 1] || '?', pixels: n, share: +((n / (w * h)) * 100).toFixed(2) }));
  }

  // Доля кадра вне карты теней (режим 3: зелёный — внутри, красный — снаружи), в процентах.
  static shadowCoverageReport() {
    const gl = Castle.gl;
    const prev = Castle.shadowDebugMode;
    Castle.shadowDebugMode = 3;
    Castle.loop();
    const w = gl.drawingBufferWidth,
      h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    Castle.shadowDebugMode = prev;
    let inside = 0,
      outside = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 1] === 255 && px[i] === 0) inside++;
      else if (px[i] === 255 && px[i + 1] === 0) outside++;
    }
    const total = inside + outside || 1;
    return { outsidePct: +((outside / total) * 100).toFixed(1), insidePct: +((inside / total) * 100).toFixed(1) };
  }

  // Вращающиеся объекты (objRotation) — мельницы, флюгеры. Карта теней статическая и
  // перестраивается целиком только при сдвиге солнца, поэтому их тень отставала. Каждый кадр
  // перерисовываем лишь участки карты под ними. Объекты с огромным участком (птицы, летающие
  // по большому кругу) пропускаем — они обновляются вместе с общим пересчётом.
  static movingShadowMaxShare = 0.25;

  static updateMovingShadows(buildingsToDraw) {
    const size = Castle.depthTextureSize;
    const visible = buildingsToDraw.filter((b) => !b.outlined);
    const rects = [];
    const add = (obj, rotation, translation) => {
      if (!obj.objRotation || (obj.noShadowCast && Castle.dayNightActive)) return;
      const r = rotatingShadowRect(Castle, obj, rotation, translation);
      if (!r) return;
      const x0 = Math.max(0, r[0]),
        y0 = Math.max(0, r[1]),
        x1 = Math.min(size, r[2]),
        y1 = Math.min(size, r[3]);
      if (x1 <= x0 || y1 <= y0) return; // вне карты теней
      if (((x1 - x0) * (y1 - y0)) / (size * size) > Castle.movingShadowMaxShare) return;
      rects.push([x0, y0, x1, y1]);
    };
    for (const obj of Castle.sceneObjects) {
      if (obj.blend) break;
      add(obj);
    }
    for (const b of visible) {
      for (const obj of b.mesh.objects) add(obj, b.rotation, b.translation);
    }
    // пересекающиеся участки сливаем, чтобы не перерисовывать одно место дважды
    for (let merged = true; merged; ) {
      merged = false;
      for (let i = 0; i < rects.length && !merged; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i],
            c = rects[j];
          if (a[0] < c[2] && c[0] < a[2] && a[1] < c[3] && c[1] < a[3]) {
            rects[i] = [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])];
            rects.splice(j, 1);
            merged = true;
            break;
          }
        }
      }
    }
    for (const rect of rects) redrawShadowRect(Castle, rect, visible);
  }

  static smoothstep(a, b, x) {
    const t = Castle.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // Горизонтальные «вправо» и «назад» камеры замка в мире. Камера по рысканию не вращается,
  // поэтому считаем один раз: проецируем сдвиги от центра сцены и смотрим, куда они уходят.
  static getCamAxes() {
    if (Castle.camAxes || !Castle.viewProjMatr || !Castle.smCenter) return Castle.camAxes;
    const project = (p) => {
      const v = vec4.transformMat4(vec4.create(), [p[0], p[1], p[2], 1], Castle.viewProjMatr);
      return [v[0] / v[3], v[3]];
    };
    const c = Castle.smCenter;
    const vm = Castle.viewMatrix2;
    let right = vec3.normalize(vec3.create(), [vm[0], 0, vm[8]]);
    let back = vec3.normalize(vec3.create(), [vm[2], 0, vm[10]]);
    if (project([c[0] + right[0] * 50, c[1], c[2] + right[2] * 50])[0] < project(c)[0]) vec3.negate(right, right);
    // «назад» — к камере: точка, сдвинутая назад, ближе к камере (меньше w)
    if (project([c[0] + back[0] * 50, c[1], c[2] + back[2] * 50])[1] > project(c)[1]) vec3.negate(back, back);
    Castle.camAxes = { right, back };
    return Castle.camAxes;
  }

  static isGroundDecal(obj, bboxMin, bboxMax) {
    const ext = [0, 1, 2].map((k) => bboxMax[k] - bboxMin[k]);
    const maxExt = Math.max(...ext);
    const k = ext.indexOf(Math.min(...ext));
    if (!(maxExt > 0) || ext[k] > 1.5 || ext[k] / maxExt > 0.05) return false;
    // нормаль плоскости — локальная ось k в мире (transform хранится построчно, как в шейдере)
    const t = obj.transform || [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
    const n = [t[k], t[4 + k], t[8 + k]];
    const len = Math.hypot(n[0], n[1], n[2]);
    return len > 0 && Math.abs(n[1]) / len > 0.9;
  }

  static setLightFromSun(dir) {
    const c = Castle.smCenter;
    const d = Castle.sunDist;
    const eye = [c[0] + dir[0] * d, c[1] + dir[1] * d, c[2] + dir[2] * d];
    const up = Math.abs(dir[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
    const view = mat4.lookAt(mat4.create(), eye, c, up);
    const view2 = mat4.multiply(mat4.create(), Castle.flipMatr, view);
    mat4.multiply(Castle.lightViewProjMatrix, Castle.smProj, view2);
  }

  // Настройка «Смена дня и ночи» (Доп. настройки). Выключено — всё как до неё: исходная неподвижная
  // камера теней фракции, прежняя формула света, прежнее смещение глубины, все объекты отбрасывают тень.
  static get dayNightEnabled() {
    return Settings.settings?.dayNight !== false;
  }

  // Настройка «Огни зданий»: отложенное освещение с точечными источниками. Работает вместе со сменой
  // дня и ночи (огни горят ночью); выключено или без нужных расширений WebGL — прежняя отрисовка.
  static get deferredActive() {
    return (
      CastleLighting.supported &&
      Settings.settings?.buildingLights !== false &&
      Castle.dayNightActive &&
      !Castle.shadowDebugMode &&
      Castle.sceneShaders?.[0]?.PSO_GB != null
    );
  }

  static disableDayNight() {
    Castle.dayNightActive = false;
    Castle.sunLight = [1, 1, 1, 1];
    Castle.ambientLight = [1, 1, 1, 0.001];
    CastleLighting.nightLevel = 0;
    if (Castle.isSMEnabled && Castle.currentSceneName) {
      Castle.setupLightMatrix(Castle.currentSceneName);
      Castle.isStaticSMCached = false;
    }
  }

  static updateDayNight() {
    if (!Castle.dayNightEnabled) {
      if (Castle.dayNightActive) Castle.disableDayNight();
      return;
    }
    const axes = Castle.getCamAxes();
    if (!axes) return;
    if (!Castle.dayNightActive) {
      Castle.dayNightActive = true;
      Castle.sunDirForSM = null;
    }
    const cycle = Castle.dayCycleSeconds;
    const p =
      Castle.dayTimeOverride !== null
        ? Castle.dayTimeOverride
        : Castle.dayMode !== 'cycle'
          ? Castle.dayModeTime[Castle.dayMode]
          : ((Date.now() / 1000) % cycle) / cycle;
    const day = Castle.dayShare;
    const e = (Castle.sunMaxElevationDeg * Math.PI) / 180;
    let theta, altitude;
    if (p < day) {
      theta = (Math.PI * p) / day;
      altitude = Math.sin(theta) * Math.sin(e);
    } else {
      // ночь: солнце под горизонтом (тени не нужны), высота уходит в минус и возвращается
      theta = p - day < (1 - day) / 2 ? Math.PI : 0;
      altitude = -0.5 * Math.sin((Math.PI * (p - day)) / (1 - day));
    }
    const { right, back } = axes;
    const st = Math.sin(theta),
      ct = Math.cos(theta);
    const dir = vec3.normalize(vec3.create(), [
      ct * right[0] + st * Math.cos(e) * back[0],
      st * Math.sin(e) + 0.02,
      ct * right[2] + st * Math.cos(e) * back[2],
    ]);

    // Сцена рассчитана на свет сверху: за краем карты меши обрезаны по прямой, и при низком солнце
    // их тень ложилась через весь замок полосами с прямыми краями. Для теней и направленного света
    // солнце не опускается ниже sunMinShadowElevationDeg — восход/закат передают цвет и яркость.
    const minElev = (Castle.sunMinShadowElevationDeg * Math.PI) / 180;
    if (Math.asin(Castle.clamp(dir[1], -1, 1)) < minElev) {
      const h = Math.hypot(dir[0], dir[2]) || 1;
      dir[0] = (dir[0] / h) * Math.cos(minElev);
      dir[2] = (dir[2] / h) * Math.cos(minElev);
      dir[1] = Math.sin(minElev);
    }

    // Прямой свет (и с ним тени) гаснет полностью к моменту, когда солнце касается горизонта,
    // общая яркость и небо темнеют дольше — сумерки после заката.
    const sunStrength = Castle.smoothstep(0.0, 0.18, altitude);
    const daylight = Castle.smoothstep(-0.12, 0.12, altitude);
    Castle.daylight = daylight;
    const highSun = Castle.smoothstep(0.02, 0.45, altitude);
    // низкое солнце тёплое, высокое — почти белое
    const sun = [1.0, 0.55 + 0.43 * highSun, 0.3 + 0.62 * highSun].map((x) => x * sunStrength);
    const exposure = Castle.nightExposure + (1 - Castle.nightExposure) * daylight;
    Castle.sunLight = [sun[0], sun[1], sun[2], exposure];
    // ночной фон голубоватый, дневной нейтральный
    Castle.ambientLight = [0.62 + 0.38 * daylight, 0.72 + 0.28 * daylight, 1.0, 0.0004];
    // огни зданий загораются на закате, пока солнце ещё не ушло, и гаснут после рассвета
    CastleLighting.nightLevel = 1 - Castle.smoothstep(-0.08, 0.2, altitude);

    // Карту теней ведём и ночью: в середине ночи направление переключается с заката на восход,
    // пока прямого света нет и теней не видно. Раньше ночью она замирала на закате и на рассвете
    // разворачивалась на 180 градусов прямо на глазах.
    if (Castle.isSMEnabled && Castle.smCenter && Castle.smProj) {
      const prev = Castle.sunDirForSM;
      // Пересчёт карты теней (8192x8192) стоит ~2.5 мс на RTX 3080 Ti и заметно больше на встроенной
      // графике, поэтому не чаще smUpdateIntervalMs, даже если солнце движется быстро.
      const now = performance.now();
      const moved = !prev || vec3.dot(prev, dir) < Math.cos((0.25 * Math.PI) / 180);
      if (moved && (!prev || now - Castle.sunSMUpdatedAt >= Castle.smUpdateIntervalMs)) {
        Castle.sunSMUpdatedAt = now;
        Castle.setLightFromSun(dir);
        Castle.sunDirForSM = dir;
        Castle.isStaticSMCached = false;
      }
    }
  }

  // Загрузка сцены фракции при запуске (initDemo). Смена фракции — switchScene.
  static async loadScene(sceneName) {
    Castle.applyScene(await Castle.buildScene(sceneName, Castle.INIT_BUDGET_MS));
  }

  // Работа загрузки за кадр, мс: при запуске замок ещё не рисуется, при смене фракции рисуется старая сцена
  static INIT_BUDGET_MS = 50;
  static SWITCH_BUDGET_MS = 6;

  // Сцена фракции (объекты, здания, текстуры, шейдеры с дефайном фракции) — в отдельном объекте,
  // текущую сцену не трогает: при смене фракции старая рисуется, пока грузится новая.
  static async buildScene(sceneName, budgetMs) {
    const scene = {
      name: sceneName,
      factionDef: sceneName == 'doct' ? 'SCENE_DOCT' : 'SCENE_AD',
      sceneObjects: [],
      sceneBuildings: {},
      sceneTextures: [],
      sceneTextureAvg: [],
      sceneShaders: [],
      debugObjects: [],
    };

    let shaderNames = [],
      texNames = [];

    let sceneMeshesToLoadCount = -1; // Initial value. Scene must have objects

    let result = await HTTP.request('content/scenes.json');

    scene.scenesJson = result;

    scene.currentScene = result.scenes.find((value) => value.sceneName === sceneName);

    sceneMeshesToLoadCount = scene.currentScene.objects.length + scene.currentScene.buildings.length; // Set scene objects count to some valid value

    for (let obj of scene.currentScene.objects) {
      scene.sceneObjects.push({
        meshName: obj.mesh,
        meshData: {},
        shader: obj.shader,
        shaderId: {},
        blend: obj.blend,
        tintColor: obj.tintColor,
        uvScale: obj.uvScale,
        uvScroll: obj.uvScroll,
        texture: obj.texture,
        texture_2: obj.texture_2,
        texture_3: obj.texture_3,
        texture_4: obj.texture_4,
        textureId: {},
        texture2Id: {},
        texture3Id: {},
        texture4Id: {},
        strip: obj.strip,
        objRotation: obj.objRotation,
        startFreq: obj.startFreq,
        endAmp: obj.endAmp,
        animDir: obj.animDir,
        transform: obj.transform,
        indexCount: obj.indexCount,
      });

      Castle.loadObjectResources(shaderNames, texNames, obj);

      sceneMeshesToLoadCount--; // Decrement after each loaded object
    }

    for (let building of scene.currentScene.buildings) {
      let buildingTranslation = building.translation ? building.translation : [0, 0];

      for (let obj of building.objects) {
        obj.transform[3] -= buildingTranslation[0];

        obj.transform[11] -= buildingTranslation[1];

        if (!(building.name in scene.sceneBuildings)) {
          scene.sceneBuildings[building.name] = {
            size: building.size,
            objects: [],
            transparentObjects: [],
          };
        }

        let selectedContainer = obj.blend
          ? scene.sceneBuildings[building.name].transparentObjects
          : scene.sceneBuildings[building.name].objects;

        selectedContainer.push({
          meshName: obj.mesh,
          meshData: {},
          shader: obj.shader,
          shaderId: {},
          blend: obj.blend,
          tintColor: obj.tintColor,
          uvScale: obj.uvScale,
          uvScroll: obj.uvScroll,
          texture: obj.texture,
          texture_2: obj.texture_2,
          texture_3: obj.texture_3,
          texture_4: obj.texture_4,
          textureId: {},
          texture2Id: {},
          texture3Id: {},
          texture4Id: {},
          strip: obj.strip,
          objRotation: obj.objRotation,
          startFreq: obj.startFreq,
          endAmp: obj.endAmp,
          animDir: obj.animDir,
          transform: obj.transform,
          indexCount: obj.indexCount,
        });

        Castle.loadObjectResources(shaderNames, texNames, obj);
      }

      sceneMeshesToLoadCount--;
    }

    const budget = new FrameBudget(budgetMs);
    await Castle.loadResources(scene, shaderNames, texNames, budget);
    // карта высот рельефа для светлячков — до подмены сцены, порциями
    await CastleFireflies.buildHeightField(scene, () => budget.slice());

    return scene;
  }

  // Сделать собранную сцену текущей (между кадрами, целиком)
  static applyScene(scene) {
    Castle.currentSceneName = scene.name;
    Castle.shaderFactionDef = scene.factionDef;
    Castle.scenesJson = scene.scenesJson;
    Castle.currentScene = scene.currentScene;
    Castle.sceneObjects = scene.sceneObjects;
    Castle.sceneBuildings = scene.sceneBuildings;
    Castle.sceneTextures = scene.sceneTextures;
    Castle.sceneTextureAvg = scene.sceneTextureAvg;
    Castle.sceneShaders = scene.sceneShaders;
    Castle.debugObjects = scene.debugObjects;

    Castle.identityMatrix = new Float32Array(16);

    mat4.identity(Castle.identityMatrix);

    // источники света зданий — из их свечений (нужны загруженные меши и средние цвета текстур)
    CastleLighting.buildTemplates(Castle);
    // места светлячков (по карте высот из buildScene)
    CastleFireflies.spawn(Castle);

    Castle.updateGridTranslation();
  }

  static updateGridTranslation() {
    if (Castle.sceneBuildings) {
      var gridBuilding = Castle.sceneBuildings['grid'];

      var gridTransform = gridBuilding.transparentObjects[0].transform;

      Castle.gridTranslation = [gridTransform[3], gridTransform[11]];

      Castle.gridTranslationY = gridTransform[7];
    } else {
      Castle.gridTranslation = [0, 0];
    }
  }

  static startCastleMusic(sceneName) {
    switch (sceneName) {
      case 'ad':
        var soundFiles = Object.values(SOUNDS_LIBRARY.AD);
        break;
      case 'doct':
        var soundFiles = Object.values(SOUNDS_LIBRARY.DOCT);
        break;
      default:
        App.error('Unknown scene name for castle music: ' + sceneName);
        break;
    }

    Castle.musicQueue = [];

    let playCastleMusic = function () {
      let musicName = Castle.nextCastleMusic(soundFiles);
      console.log('Playing castle music: ' + musicName);
      Sound.stop('castle');
      Sound.play(musicName, { id: 'castle', volume: Castle.GetVolume(Castle.AUDIO_MUSIC) }, playCastleMusic);
    };
    playCastleMusic();
  }

  // Следующий трек из очереди. Когда круг доигран, очередь перемешивается заново,
  // и только что звучавший трек не может открыть новый круг (без повтора подряд).
  static nextCastleMusic(soundFiles) {
    if (!Castle.musicQueue.length) {
      const queue = [...soundFiles];
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
      if (queue.length > 1 && queue[0] === Castle.lastMusic) {
        [queue[0], queue[queue.length - 1]] = [queue[queue.length - 1], queue[0]];
      }
      Castle.musicQueue = queue;
    }
    Castle.lastMusic = Castle.musicQueue.shift();
    return Castle.lastMusic;
  }

  // Смена фракции без перезагрузки лаунчера: тот же WebGL-контекст, обработчики и цикл отрисовки,
  // заново грузится только сцена (объекты, здания, текстуры, шейдеры), свет теней и музыка.
  // Расстановка зданий (castle.cfg) общая для обеих фракций и не меняется.
  // Без подвисания: новая сцена собирается порциями между кадрами, пока рисуется старая, затем
  // подменяется целиком, а последний кадр старой растворяется поверх новой (CastleSceneFade).
  static async switchScene(sceneName) {
    if (!Castle.gl || sceneName === Castle.currentSceneName || Castle.sceneLoading) return;
    Castle.sceneLoading = true;
    try {
      const scene = await Castle.buildScene(sceneName, Castle.SWITCH_BUDGET_MS);

      // снимок — только если замок сейчас рисуется (иначе кадр не придёт)
      if (!Castle.render.includes(false)) await CastleSceneFade.capture();

      const old = {
        sceneObjects: Castle.sceneObjects,
        sceneBuildings: Castle.sceneBuildings,
        sceneTextures: Castle.sceneTextures,
        sceneShaders: Castle.sceneShaders,
      };
      Castle.applyScene(scene);
      Castle.freeScene(old);

      if (Castle.isSMEnabled) {
        Castle.setupLightMatrix(sceneName);
      }
      Castle.isStaticSMCached = false;

      Sound.stop('castle');
      Castle.startCastleMusic(sceneName);
    } finally {
      Castle.sceneLoading = false;
    }
  }

  // Освободить GPU-ресурсы сцены, которая уже не текущая
  static freeScene(scene) {
    const gl = Castle.gl;
    const freeMeshes = (list) => {
      for (const obj of list || []) {
        if (obj.meshData && obj.meshData.vertices) gl.deleteBuffer(obj.meshData.vertices);
      }
    };
    freeMeshes(scene.sceneObjects);
    for (const name in scene.sceneBuildings || {}) {
      freeMeshes(scene.sceneBuildings[name].objects);
      freeMeshes(scene.sceneBuildings[name].transparentObjects);
    }
    for (const texture of scene.sceneTextures || []) {
      if (texture) gl.deleteTexture(texture);
    }
    for (const shader of scene.sceneShaders || []) {
      for (const program of [shader?.PSO, shader?.PSO_SM, shader?.PSO_GB]) {
        if (!program?.prog) continue;
        gl.deleteProgram(program.prog);
        delete Castle.uniformLocationCache[program.progId];
      }
    }
    // Отрисовка только включает атрибуты (enableVertexAttribArray) и не выключает. После удаления
    // буферов включённый атрибут без буфера даёт INVALID_OPERATION на drawArrays, если шейдеры
    // новой фракции его не перепривяжут, — выключаем все, нужные включатся при отрисовке.
    const maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    for (let i = 0; i < maxAttribs; i++) gl.disableVertexAttribArray(i);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  static sceneLoading = false;

  static loadObjectResources(shaderNames, texNames, obj) {
    shaderNames.push(obj.shader);

    texNames.push(obj.texture);

    if (obj.texture_2) {
      texNames.push(obj.texture_2);
    }

    if (obj.texture_3) {
      texNames.push(obj.texture_3);
    }

    if (obj.texture_4) {
      texNames.push(obj.texture_4);
    }
  }

  static uniformLocationCache = new Object();
  static getUniformLocation(program, name) {
    if (program.progId in this.uniformLocationCache) {
      if (name in this.uniformLocationCache[program.progId]) {
        return this.uniformLocationCache[program.progId][name];
      }
    } else {
      this.uniformLocationCache[program.progId] = new Object();
    }
    let uniformLocation = Castle.gl.getUniformLocation(program.prog, name);
    this.uniformLocationCache[program.progId][name] = uniformLocation;
    return uniformLocation;
  }

  // Места uniform-ов программы сцены — один раз, в объекте с постоянными полями: drawObject зовут
  // сотни раз за кадр, поиск по имени на каждый объект заметно стоит. Заодно состояние программы:
  // в каком кадре ставились общие uniform-ы и какие номера текстур уже записаны (значения uniform-ов
  // хранятся в самой программе). program — { prog, progId }: после пересборки шейдеров она новая.
  static programLocs(program) {
    let l = program.locs;
    if (l) return l;
    const u = (name) => Castle.getUniformLocation(program, name);
    l = program.locs = {
      mViewProj: u('mViewProj'),
      lightViewProj: u('lightViewProj'),
      sunLight: u('sunLight'),
      ambientLight: u('ambientLight'),
      zNearFar: u('zNear_zFar'),
      cursorGrid: u('cursorGridPosition'),
      shadowDebug: u('shadowDebug'),
      time: u('time'),
      tintColor: u('tintColor'),
      uvScale: u('uvScale'),
      emissive: u('emissive'),
      startFreq: u('startFreq'),
      endAmp: u('endAmp'),
      animDirVertFreq: u('animDirVertFreq'),
      uvScroll: u('uvScroll'),
      mWorld: u('mWorld'),
      bones: u('bones'),
      smDebugColor: u('smDebugColor'),
      tex: [u('tex0'), u('tex1'), u('tex2'), u('tex3')],
      texUnit: [-1, -1, -1, -1], // какой номер текстуры уже записан в tex0..3
      smTexture: u('smTexture'),
      smTextureUnit: -1,
      frame: -1, // кадр, в котором ставились общие для всех объектов uniform-ы (камера, свет, время)
      attribsFor: null, // список атрибутов шейдера, для которого посчитаны места attribs
      attribs: null,
    };
    return l;
  }

  // Места атрибутов (getAttribLocation на каждый объект — дорогой вызов)
  static attribLocations(program, l, attributes) {
    if (l.attribsFor !== attributes) {
      l.attribsFor = attributes;
      l.attribs = attributes.map((attribute) => Castle.gl.getAttribLocation(program.prog, attribute.name));
    }
    return l.attribs;
  }

  // Шейдеры, текстуры и меши сцены. Файлы грузятся параллельно, работа на главном потоке
  // (загрузка в GPU, разбор мешей) идёт порциями по budget, шейдеры компилируются в фоне.
  static async loadResources(scene, notUniqeShaderNames, notUniqeTexNames, budget) {
    const gl = Castle.gl;
    let shaderNames = [...new Set(notUniqeShaderNames)];
    let texNames = [...new Set(notUniqeTexNames)];

    function remapIndices(sceneObjectsContainer, objId) {
      sceneObjectsContainer[objId].shaderId = shaderNames.findIndex((value) => value === sceneObjectsContainer[objId].shader);
      sceneObjectsContainer[objId].textureId = texNames.findIndex((value) => value === sceneObjectsContainer[objId].texture);
      sceneObjectsContainer[objId].texture2Id = texNames.findIndex((value) => value === sceneObjectsContainer[objId].texture_2);
      sceneObjectsContainer[objId].texture3Id = texNames.findIndex((value) => value === sceneObjectsContainer[objId].texture_3);
      sceneObjectsContainer[objId].texture4Id = texNames.findIndex((value) => value === sceneObjectsContainer[objId].texture_4);
    }

    // все меши сцены: [контейнер, индекс] — объекты сцены, затем здания
    const meshes = [];
    for (let objId = 0; objId < scene.sceneObjects.length; objId++) {
      remapIndices(scene.sceneObjects, objId);
      meshes.push([scene.sceneObjects, objId]);
    }
    for (let b in scene.sceneBuildings) {
      for (const container of [scene.sceneBuildings[b].objects, scene.sceneBuildings[b].transparentObjects]) {
        for (let objId = 0; objId < container.length; ++objId) {
          remapIndices(container, objId);
          meshes.push([container, objId]);
        }
      }
    }

    scene.sceneTextures = new Array(texNames.length);
    scene.sceneTextureAvg = new Array(texNames.length);
    scene.sceneShaders = new Array(shaderNames.length);

    const [vsText, fsText, ...definesTexts] = await Promise.all([
      HTTP.request(`content/shaders/shader.vs.glsl`, 'text'),
      HTTP.request(`content/shaders/shader.fs.glsl`, 'text'),
      ...shaderNames.map((name) => HTTP.request(`content/shaders/${name}.glsl`, 'text')),
    ]);

    // компиляция идёт, пока грузятся текстуры и меши
    const shadersReady = Castle.compileSceneShaders(scene, shaderNames, definesTexts, vsText, fsText, budget);

    const texturesReady = forEachLimited(texNames, 8, async (name, i) => {
      let image = await PreloadImages.loadAsync(`content/textures/${name}.webp`);
      // Распаковать картинку заранее, вне главного потока, — иначе её распакует texImage2D. Не image.decode():
      // он ждёт отрисовки кадра и в свёрнутом окне не завершается. Параметры — как у texImage2D по умолчанию.
      try {
        image = await createImageBitmap(image, { premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
      } catch (e) {}
      await budget.slice();
      // средний цвет — цвет источника света у свечений зданий (CastleLighting.glowOf)
      scene.sceneTextureAvg[i] = CastleLighting.averageColor(image);
      // Грани скайбокса (sky_*) — без повтора: при REPEAT край грани подмешивает противоположный
      // край, и на стыке граней видна тонкая линия.
      scene.sceneTextures[i] = Castle.loadTexture(image, /^sky_/.test(name) ? gl.CLAMP_TO_EDGE : gl.REPEAT);
      image.close?.();
    });

    const meshesReady = forEachLimited(meshes, 8, async ([container, objId]) => {
      const meshData = await HTTP.request(`content/meshes/${container[objId].meshName}`, 'arrayBuffer');
      await budget.slice();
      Castle.uploadMesh(scene, shaderNames, container, objId, meshData);
    });

    await Promise.all([shadersReady, texturesReady, meshesReady]);

    // id для отладки (debugObjects) — в порядке сцены, как при последовательной загрузке
    for (const [container, objId] of meshes) {
      container[objId].debugId = scene.debugObjects.push(container[objId].meshName);
    }
  }

  // Программы шейдеров сцены: цвет, карта теней и G-buffer (если есть отложенное освещение).
  // С KHR_parallel_shader_compile драйвер компилирует их в своих потоках, а мы только опрашиваем
  // готовность раз в кадр; без расширения — по одной программе за порцию бюджета.
  static async compileSceneShaders(scene, shaderNames, definesTexts, vsText, fsText, budget) {
    const gl = Castle.gl;
    const parallel = gl.getExtension('KHR_parallel_shader_compile');
    const fd = scene.factionDef;

    const startPrograms = (definesText) => ({
      programColor: Castle.startProgram(`\n#define RENDER_PASS_COLOR\n #define ${fd}`, definesText, vsText, fsText),
      programSM: Castle.startProgram(`\n#define RENDER_PASS_SM\n #define ${fd}`, definesText, vsText, fsText),
      // G-buffer отложенного освещения (CastleLighting) — тот же шейдер с тремя выходами
      programGB: CastleLighting.supported
        ? Castle.startProgram(
            `\n#define RENDER_PASS_COLOR\n#define DEFERRED\n #define ${fd}`,
            definesText,
            vsText,
            fsText,
            '#extension GL_EXT_draw_buffers : require\n',
          )
        : null,
    });
    const finishPrograms = (p) => ({
      programColor: Castle.finishProgram(p.programColor),
      programSM: Castle.finishProgram(p.programSM),
      programGB: p.programGB ? Castle.finishProgram(p.programGB) : null,
    });

    const jobs = shaderNames.map((name, i) => {
      let definesText = definesTexts[i];
      // Скиннинг (VS_SKIN) — размер массива костей. Если шейдер со скиннингом не собрался (например, не хватило
      // uniform-векторов: нужно 3 на кость), собираем без VS_SKIN — такие объекты стоят в позе привязки.
      const skinned = /#define VS_SKIN\b/.test(definesText);
      if (skinned) definesText += `\n#define SKIN_MAX_BONES ${Castle.SKIN_MAX_BONES}\n`;
      return { name, definesText, skinned, started: null };
    });

    if (parallel) {
      for (const job of jobs) job.started = startPrograms(job.definesText);
      const progs = jobs.flatMap((job) =>
        Object.values(job.started)
          .filter(Boolean)
          .map((p) => p.prog),
      );
      while (!progs.every((prog) => gl.getProgramParameter(prog, parallel.COMPLETION_STATUS_KHR))) {
        await yieldFrame();
      }
    }

    for (let i = 0; i < jobs.length; ++i) {
      const job = jobs[i];
      if (!job.started) {
        await budget.slice();
        job.started = startPrograms(job.definesText);
      }
      let { programColor, programSM, programGB } = finishPrograms(job.started);

      if (job.skinned && (programColor === 1 || programSM === 1)) {
        console.warn('Castle: шейдер со скиннингом не собрался, скиннинговые объекты без анимации');
        for (const program of [programColor, programSM, programGB]) if (program && program !== 1) gl.deleteProgram(program.prog);
        ({ programColor, programSM, programGB } = finishPrograms(startPrograms(job.definesText.replace(/#define VS_SKIN\b/, ''))));
      }

      scene.sceneShaders[i] = {
        PSO: programColor,
        PSO_SM: programSM,
        PSO_GB: programGB && programGB !== 1 ? programGB : null,
        attributes: scene.scenesJson.shaderLayouts.find((value) => value.name === job.name).layout,
        vertStride: 0,
      };
    }
  }

  static uniqueProgCounter = 0;

  // Скиннинг в убер-шейдере (VS_SKIN): размер uniform-массива костей (loadResources)
  static SKIN_MAX_BONES = 72;
  static _bindPoseBones = null;

  // Кости в позе привязки (единичные матрицы, 3 строки на кость) — пока объект не получил свою позу
  static bindPoseBones() {
    if (!Castle._bindPoseBones) {
      Castle._bindPoseBones = new Float32Array(Castle.SKIN_MAX_BONES * 12);
      for (let i = 0; i < Castle.SKIN_MAX_BONES; i++) {
        Castle._bindPoseBones[i * 12] = 1;
        Castle._bindPoseBones[i * 12 + 5] = 1;
        Castle._bindPoseBones[i * 12 + 10] = 1;
      }
    }
    return Castle._bindPoseBones;
  }

  static shaderFactionDef = 'INVALID_DEFINE';

  // fsPrefix — строки, которые должны стоять до любого кода фрагментного шейдера (#extension)
  static prepareShader(renderPassDefine, definesText, vsText, fsText, fsPrefix = '') {
    return Castle.finishProgram(Castle.startProgram(renderPassDefine, definesText, vsText, fsText, fsPrefix));
  }

  // Компиляция и сборка программы без опроса статуса: опрос ждёт драйвер, а с
  // KHR_parallel_shader_compile до готовности (COMPLETION_STATUS_KHR) работа идёт в фоне
  static startProgram(renderPassDefine, definesText, vsText, fsText, fsPrefix = '') {
    const gl = Castle.gl;
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);

    gl.shaderSource(vertexShader, definesText + renderPassDefine + vsText);
    gl.shaderSource(fragmentShader, fsPrefix + definesText + renderPassDefine + fsText);
    gl.compileShader(vertexShader);
    gl.compileShader(fragmentShader);

    const prog = gl.createProgram();
    gl.attachShader(prog, vertexShader);
    gl.attachShader(prog, fragmentShader);
    gl.linkProgram(prog);

    return { prog, vertexShader, fragmentShader };
  }

  // Проверка собранной программы: { prog, progId } или 1, если не собралась
  static finishProgram(started) {
    const gl = Castle.gl;
    const { prog, vertexShader, fragmentShader } = started;
    const fail = (message, log) => {
      console.error(message, log);
      gl.deleteProgram(prog);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return 1;
    };

    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      return fail('ERROR compiling vertex shader!', gl.getShaderInfoLog(vertexShader));
    }
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      return fail('ERROR compiling fragment shader!', gl.getShaderInfoLog(fragmentShader));
    }
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      return fail('ERROR linking program!', gl.getProgramInfoLog(prog));
    }

    gl.validateProgram(prog);

    if (!gl.getProgramParameter(prog, gl.VALIDATE_STATUS)) {
      return fail('ERROR validating program!', gl.getProgramInfoLog(prog));
    }

    // шейдеры уже в программе — удалятся вместе с ней
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    return {
      prog,
      progId: this.uniqueProgCounter++,
    };
  }

  static lerp(a, b, alpha) {
    return a + alpha * (b - a);
  }
  static clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
  }

  static loadTexture(image, wrap = Castle.gl.REPEAT) {
    let texture = Castle.gl.createTexture();

    Castle.gl.bindTexture(Castle.gl.TEXTURE_2D, texture);

    Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_WRAP_S, wrap);

    Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_WRAP_T, wrap);

    Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_MIN_FILTER, Castle.gl.LINEAR);

    Castle.gl.texParameteri(Castle.gl.TEXTURE_2D, Castle.gl.TEXTURE_MAG_FILTER, Castle.gl.LINEAR);

    Castle.gl.texImage2D(Castle.gl.TEXTURE_2D, 0, Castle.gl.RGBA, Castle.gl.RGBA, Castle.gl.UNSIGNED_BYTE, image);

    Castle.gl.generateMipmap(Castle.gl.TEXTURE_2D);

    return texture;
  }

  // Меш из загруженного файла: буфер вершин в GPU, границы, средний цвет вершин
  static uploadMesh(scene, shaderNames, sceneObjectsContainer, objectId, meshData) {
    let vertices = Castle.gl.createBuffer();

    let meshFloat = new Float32Array(meshData);

    Castle.gl.bindBuffer(Castle.gl.ARRAY_BUFFER, vertices);

    Castle.gl.bufferData(Castle.gl.ARRAY_BUFFER, meshFloat, Castle.gl.STATIC_DRAW);

    let attributes = scene.scenesJson.shaderLayouts.find(
      (value) => value.name === shaderNames[sceneObjectsContainer[objectId].shaderId],
    ).layout;

    let vertStride = 0;

    for (let attribute of attributes) {
      vertStride += attribute.count * attribute.sizeElem;
    }

    let indexCount = meshFloat.length / (vertStride / 4);

    if (indexCount != sceneObjectsContainer[objectId].indexCount) {
      console.error('Fatal error getting index count (' + meshName + ')');
    }

    // локальные границы меша — для частичного обновления карты теней (EaselCastleFx.updateShadow)
    let posOffset = 0;
    for (let attribute of attributes) {
      if (attribute.name === 'vertPosition') break;
      posOffset += attribute.count * attribute.sizeElem;
    }
    let bboxMin = [Infinity, Infinity, Infinity];
    let bboxMax = [-Infinity, -Infinity, -Infinity];
    for (let i = posOffset / 4; i + 2 < meshFloat.length; i += vertStride / 4) {
      for (let k = 0; k < 3; ++k) {
        bboxMin[k] = Math.min(bboxMin[k], meshFloat[i + k]);
        bboxMax[k] = Math.max(bboxMax[k], meshFloat[i + k]);
      }
    }

    // средний цвет вершин (0..1) — для цвета источника у свечений с цветом вершин (CastleLighting.glowOf)
    let avgColor = null;
    let colorOffset = 0;
    for (let attribute of attributes) {
      if (attribute.name === 'vertColor') {
        const bytes = new Uint8Array(meshData);
        avgColor = [0, 0, 0, 0];
        let n = 0;
        for (let v = colorOffset; v + 3 < bytes.length; v += vertStride, n++) {
          for (let k = 0; k < 4; ++k) avgColor[k] += bytes[v + k];
        }
        avgColor = avgColor.map((x) => (n ? x / n / 255 : 0));
        break;
      }
      colorOffset += attribute.count * attribute.sizeElem;
    }

    sceneObjectsContainer[objectId].meshData = {
      vertices: vertices,
      vertStride: vertStride,
      indexCount: meshFloat.length / (vertStride / 4),
      bboxMin: bboxMin,
      bboxMax: bboxMax,
      avgColor: avgColor,
    };
    // вершины рельефа, деревьев и кустов — для карты высот светлячков (CastleFireflies)
    CastleFireflies.keepGroundPositions(sceneObjectsContainer[objectId], meshFloat, vertStride, posOffset);

    // Плоские горизонтальные подложки зданий (квадрат земли/травы чуть над рельефом) не должны
    // отбрасывать тень: при солнце сверху она пряталась под самой подложкой, а при низком солнце
    // (смена дня и ночи) уезжала в сторону тёмным параллелограммом.

    // Рельеф (terrain/understage, у Доктов горы — doct/rocks_*) тень принимает, но не отбрасывает: его меши обрезаны по прямой за
    // краем карты, и при солнце сбоку их тень ложилась на замок многоугольниками с прямыми краями
    // (видно в Castle.setShadowDebug(1)). Скалы, деревья и здания тени отбрасывают как обычно.
    sceneObjectsContainer[objectId].noShadowCast =
      /^sky_|(^|\/)(terrain|understage)|^doct\/rocks_/.test(sceneObjectsContainer[objectId].meshName) ||
      Castle.isGroundDecal(sceneObjectsContainer[objectId], bboxMin, bboxMax);

    // Add up first vertex as base offset
    if (sceneObjectsContainer[objectId].startFreq) {
      sceneObjectsContainer[objectId].startFreq[0] += meshFloat[0];
      sceneObjectsContainer[objectId].startFreq[1] += meshFloat[1];
      sceneObjectsContainer[objectId].startFreq[2] += meshFloat[2];
    }

    if (sceneObjectsContainer[objectId].endAmp) {
      sceneObjectsContainer[objectId].endAmp[0] += meshFloat[0];
      sceneObjectsContainer[objectId].endAmp[1] += meshFloat[1];
      sceneObjectsContainer[objectId].endAmp[2] += meshFloat[2];
    }

    //console.log('Loaded mesh ' + meshName);
  }

  static MainLoop(sceneObjects, sceneBuildings, sceneShaders, sceneTextures) {
    Castle.updateGridTranslation();
    Castle.loopSleeping = false;
    requestAnimationFrame(Castle.loop);
  }

  static loop() {
    // Пока switchScene грузит сцену другой фракции, рисуется старая: новая собирается отдельно (buildScene).
    // Отрисовка выключена (3D-замок выключен в настройках, идёт игра, открыта мини-игра) — цикл засыпает,
    // а не крутится вхолостую каждый кадр: пустые кадры тоже стоят браузеру работы. Будит toggleRender.
    let isStopRender = Castle.render.includes(false);
    if (isStopRender) {
      Castle.loopSleeping = true;
      return;
    }

    // общие uniform-ы (камера, свет, время) каждая программа получает один раз за кадр (setupMainCam)
    Castle.frameId++;

    Castle.prevTime = Castle.currentTime;

    Castle.currentTime = (Date.now() - Castle.loadTime) / 1000.0;

    Castle.deltaTime = Castle.currentTime - Castle.prevTime;

    // Update cam behaviour

    let factor = Castle.clamp(Castle.cameraAnimationSpeed * Castle.deltaTime, 0, 1);

    Castle.currentFixedValue = Castle.lerp(Castle.currentFixedValue, Castle.targetFixedValue, factor);

    let targetFovs = [
      Castle.fixedFovValues[Math.round(Castle.initialFixedValue)],
      Castle.fixedFovValues[Math.round(Castle.targetFixedValue)],
    ];

    let targetRots = [
      Castle.fixedRotationTiltValues[Math.round(Castle.initialFixedValue)],
      Castle.fixedRotationTiltValues[Math.round(Castle.targetFixedValue)],
    ];

    let targetCHVs = [
      Castle.fixedCameraHeightValues[Math.round(Castle.initialFixedValue)],
      Castle.fixedCameraHeightValues[Math.round(Castle.targetFixedValue)],
    ];

    let camLerp = Math.abs(Castle.initialFixedValue - Castle.currentFixedValue);

    Castle.fov = Castle.lerp(targetFovs[0], targetFovs[1], camLerp);

    Castle.rotationTilt = Castle.lerp(targetRots[0], targetRots[1], camLerp);

    Castle.cameraHeight = Castle.lerp(targetCHVs[0], targetCHVs[1], camLerp);

    let buildingsToDraw = [];

    for (let building of Castle.placedBuildings) {
      var mesh = Castle.sceneBuildings[Castle.buildings[building.id]];
      buildingsToDraw.push({
        mesh: mesh,
        rotation: building.rot * 1.57,
        position: [building.posX, building.posY],
        name: Castle.buildings[building.id],
        translation: [
          Castle.zeroTranslation[0] + (building.posX * 7.0 + (mesh.size[0] / 2.0) * 7.0),
          1,
          Castle.zeroTranslation[1] + ((building.posY - 17) * 7.0 + (mesh.size[1] / 2.0) * 7.0),
        ],
      });
    }
    if (Castle.buildMode && Castle.phantomBuilding.id > 0) {
      var mesh = Castle.sceneBuildings['grid'];
      buildingsToDraw.push({
        mesh: mesh,
        rotation: 0,
        position: [0, 0],
        name: 'grid',
        translation: [
          Castle.zeroTranslation[0] + (mesh.size[0] / 2.0) * 7.0,
          1 + Castle.GRID_LIFT,
          Castle.zeroTranslation[1] + (mesh.size[1] / 2.0) * 7.0,
        ],
      });
    }

    // анимация капель «Мастерской свитков» (onIdleEffect PW)
    if (buildingsToDraw.some((b) => b.name === 'easel')) {
      EaselCastleFx.update(Castle.sceneBuildings.easel, Castle.currentTime, Castle.SKIN_MAX_BONES);
    }

    Castle.updateMainCam();

    Castle.updateDayNight();

    let outlinedBuilding = -1;
    Castle.outlinedBuilding = null;
    if (Object.keys(Window.windows).length === 0) {
      // do not outline when any window is active
      if (Castle.phantomBuilding.id > 0) {
        let building = Castle.phantomBuilding;
        var mesh = Castle.sceneBuildings[Castle.buildings[building.id]];
        buildingsToDraw.push({
          outlined: true,
          mesh: mesh,
          rotation: building.rot * 1.57,
          position: [building.posX, building.posY],
          name: Castle.buildings[building.id],
          translation: [
            Castle.zeroTranslation[0] + (building.posX * 7.0 + (mesh.size[0] / 2.0) * 7.0),
            1,
            Castle.zeroTranslation[1] + ((building.posY - 17) * 7.0 + (mesh.size[1] / 2.0) * 7.0),
          ],
        });
        outlinedBuilding = buildingsToDraw.length - 1;
      } else {
        for (let i = 0; i < buildingsToDraw.length; ++i) {
          let building = buildingsToDraw[i];
          let shift = [Castle.zeroTranslation[0] + Castle.gridTranslation[0], Castle.zeroTranslation[1] + Castle.gridTranslation[1]];
          if (
            shift[0] - Castle.gridCursorPosX > building.translation[0] - (building.mesh.size[0] / 2) * 7 &&
            shift[0] - Castle.gridCursorPosX < building.translation[0] + (building.mesh.size[1] / 2) * 7 &&
            shift[1] - Castle.gridCursorPosZ > building.translation[2] - (building.mesh.size[1] / 2) * 7 &&
            shift[1] - Castle.gridCursorPosZ < building.translation[2] + (building.mesh.size[1] / 2) * 7 &&
            (buildingsToDraw[i].name in CastleBuildingsEvents || Castle.buildMode)
          ) {
            outlinedBuilding = i;
            Castle.outlinedBuilding = buildingsToDraw[outlinedBuilding];
            break;
          }
        }
      }
    }

    // питомцы в домиках (и в домике-фантоме при постройке) — после того, как фантом попал в список
    CastlePets.update(Castle, buildingsToDraw);

    if (Castle.isSMEnabled && !Castle.isStaticSMCached && Castle.sceneObjects && Castle.isBuildingsLoaded) {
      Castle.gl.bindFramebuffer(Castle.gl.FRAMEBUFFER, Castle.depthFramebuffer);
      Castle.gl.viewport(0, 0, Castle.depthTextureSize, Castle.depthTextureSize);
      Castle.gl.clear(Castle.gl.COLOR_BUFFER_BIT | Castle.gl.DEPTH_BUFFER_BIT);

      for (let i = 0; i < Castle.sceneObjects.length; ++i) {
        let obj = Castle.sceneObjects[i];
        if (obj.blend) break;
        if (obj.noShadowCast && Castle.dayNightActive) continue;
        Castle.prepareAndDrawObject(obj, true);
      }
      for (let buildingToDraw of buildingsToDraw) {
        for (let i = 0; i < buildingToDraw.mesh.objects.length; ++i) {
          if (!buildingToDraw.outlined && !(buildingToDraw.mesh.objects[i].noShadowCast && Castle.dayNightActive)) {
            Castle.prepareAndDrawObject(buildingToDraw.mesh.objects[i], true, buildingToDraw.rotation, buildingToDraw.translation);
          }
        }
      }
      Castle.isStaticSMCached = true;
    }

    // тени вращающихся объектов (мельницы, флюгеры) — каждый кадр, а не только при пересчёте карты
    if (Castle.isSMEnabled && Castle.isStaticSMCached) {
      Castle.updateMovingShadows(buildingsToDraw);
    }

    // тень анимированных капель «Мастерской свитков»: перерисовка участка карты теней
    if (Castle.isSMEnabled && Castle.isStaticSMCached && buildingsToDraw.some((b) => b.name === 'easel')) {
      EaselCastleFx.updateShadow(Castle, buildingsToDraw);
    }
    if (Castle.isSMEnabled && Castle.isStaticSMCached) {
      CastlePets.updateShadow(Castle, buildingsToDraw);
    }

    // Отложенное освещение: непрозрачное — в G-buffer, затем огни зданий и вывод на экран
    // (CastleLighting.finish), прозрачное — как раньше, поверх, с глубиной из G-buffer.
    const clearColor = [0.75, 0.85, 0.8];
    Castle.deferredPass = Castle.deferredActive && CastleLighting.beginGBuffer(Castle.gl, clearColor);
    if (!Castle.deferredPass) {
      Castle.gl.bindFramebuffer(Castle.gl.FRAMEBUFFER, null);
      Castle.gl.viewport(0, 0, Castle.gl.canvas.width, Castle.gl.canvas.height);
      Castle.gl.clearColor(clearColor[0], clearColor[1], clearColor[2], 1.0);
      Castle.gl.clear(Castle.gl.COLOR_BUFFER_BIT | Castle.gl.DEPTH_BUFFER_BIT);
    }

    // светлячки за стенами — ночью, вместе с огнями зданий (та же настройка)
    const fireflyLevel = Castle.dayNightActive && Settings.settings?.buildingLights !== false ? CastleLighting.nightLevel : 0;

    if (Castle.sceneObjects) {
      let blendsFrom;
      for (let i = 0; i < Castle.sceneObjects.length; ++i) {
        if (Castle.sceneObjects[i].blend) {
          blendsFrom = i;
          break;
        }
        Castle.prepareAndDrawObject(Castle.sceneObjects[i], false);
      }

      if (outlinedBuilding >= 0) {
        Castle.gl.disable(Castle.gl.DEPTH_TEST);
        Castle.gl.depthMask(false);
        let buildingToDraw = buildingsToDraw[outlinedBuilding];
        let outlineColor = Castle.BUILDING_OUTLINE_GOOD;
        if (Castle.buildMode) {
          outlineColor = Castle.BUILDING_OUTLINE_SELECTION;
          if (Castle.phantomBuilding.id > 0) {
            outlineColor = Castle.phantomBuildingIsAllowedToBuild ? Castle.BUILDING_OUTLINE_GOOD : Castle.BUILDING_OUTLINE_BAD;
          }
        }
        for (let i = 0; i < buildingToDraw.mesh.objects.length; ++i) {
          let outlinedTranslation = [buildingToDraw.translation[0], buildingToDraw.translation[1], buildingToDraw.translation[2]];
          outlinedTranslation[1] -= 6.0 / buildingToDraw.mesh.size[0];
          Castle.prepareAndDrawObject(
            buildingToDraw.mesh.objects[i],
            false,
            buildingToDraw.rotation,
            outlinedTranslation,
            outlineColor,
            1.0 + 0.16 / Math.pow(buildingToDraw.mesh.size[0], 3 / 4),
          );
        }
        Castle.gl.enable(Castle.gl.DEPTH_TEST);
        Castle.gl.depthMask(true);
      }

      for (let buildingToDraw of buildingsToDraw) {
        for (let i = 0; i < buildingToDraw.mesh.objects.length; ++i) {
          Castle.prepareAndDrawObject(buildingToDraw.mesh.objects[i], false, buildingToDraw.rotation, buildingToDraw.translation);
        }
      }

      if (fireflyLevel > 0) CastleFireflies.update(Castle.currentTime);
      if (Castle.deferredPass) {
        CastleLighting.collectLights(buildingsToDraw);
        CastleLighting.lights.push(...CastleFireflies.lights(fireflyLevel));
        CastleLighting.finish(Castle.gl, Castle);
        Castle.deferredPass = false;
      }

      for (let i = blendsFrom; i < Castle.sceneObjects.length; ++i) {
        Castle.prepareAndDrawObject(Castle.sceneObjects[i], false);
      }

      for (let buildingToDraw of buildingsToDraw) {
        for (let i = 0; i < buildingToDraw.mesh.transparentObjects.length; ++i) {
          Castle.prepareAndDrawObject(
            buildingToDraw.mesh.transparentObjects[i],
            false,
            buildingToDraw.rotation,
            buildingToDraw.translation,
          );
        }
      }

      CastleFireflies.draw(Castle.gl, Castle, fireflyLevel);
    }
    // смена фракции: снимок кадра старой сцены и его растворение поверх новой
    CastleSceneFade.afterFrame(Castle.gl);
    Castle.gl.disable(Castle.gl.BLEND);
    Castle.gl.enable(Castle.gl.CULL_FACE);
    Castle.gl.colorMask(true, true, true, true);
    Castle.gl.depthMask(true);

    Castle.cursorDeltaPos[0] = 0;
    Castle.cursorDeltaPos[1] = 0;

    requestAnimationFrame(Castle.loop);
  }

  static prepareAndDrawObject(obj, isSMPass, rotation, translation, tintOverride, scaleOverride) {
    if (!Castle.filter.test(obj.meshName)) {
      return;
    }
    let meshData = obj.meshData;
    let associatedTexture = obj.textureId;
    let associatedTexture2 = obj.texture2Id;
    let associatedTexture3 = obj.texture3Id;
    let associatedTexture4 = obj.texture4Id;
    let associatedShader = Castle.sceneShaders[obj.shaderId];

    let textures = [
      Castle.sceneTextures[associatedTexture],
      associatedTexture2 ? Castle.sceneTextures[associatedTexture2] : {},
      associatedTexture3 ? Castle.sceneTextures[associatedTexture3] : {},
      associatedTexture4 ? Castle.sceneTextures[associatedTexture4] : {},
    ];
    let uvScroll = [0.0, 0.0];

    if (obj.uvScroll) {
      uvScroll[0] = obj.uvScroll[0] * Castle.currentTime;
      uvScroll[1] = obj.uvScroll[1] * Castle.currentTime;
    }

    Castle.currentDrawObject = obj;
    Castle.drawObject(
      isSMPass ? associatedShader.PSO_SM : Castle.deferredPass && associatedShader.PSO_GB ? associatedShader.PSO_GB : associatedShader.PSO,
      textures,
      meshData.vertices,
      meshData.indexCount,
      meshData.vertStride,
      Castle.sceneShaders[obj.shaderId].attributes,
      obj.strip,
      obj.transform,
      isSMPass,
      obj.blend,
      obj.tintColor,
      obj.uvScale,
      uvScroll,
      obj.objRotation,
      rotation,
      translation,
      tintOverride,
      scaleOverride,
      obj.meshName == 'grid_9_01.bin',
      obj.startFreq,
      obj.endAmp,
      obj.animDir,
    );
  }

  static updateMainCam() {
    mat4.perspective(Castle.projMatrix, glMatrix.toRadian(Castle.fov), Castle.canvasWidth / Castle.canvasHeight, Castle.zNear, Castle.zFar);

    var camPosElements = [-1432, -440, -1582];

    var camPosX = camPosElements[0] + Castle.camDeltaPos[0];

    var camPosY = camPosElements[2] - Castle.camDeltaPos[1];

    var camPosZ = camPosElements[1] + Castle.cameraHeight;

    var camPos = vec3.fromValues(camPosX, camPosZ, camPosY);

    var camForwElements = [-2.17, -2.36, 3.14];

    var quatStart = quat.create();

    quat.identity(quatStart);

    var quatX = quat.create();

    var quatY = quat.create();

    var quatZ = quat.create();

    quat.rotateX(quatX, quatStart, camForwElements[0] + Castle.rotationTilt);

    quat.rotateY(quatY, quatX, camForwElements[1]);

    quat.rotateZ(quatZ, quatY, camForwElements[2]);

    mat4.fromRotationTranslation(Castle.viewMatrix, quatZ, vec3.create());

    mat4.translate(Castle.viewMatrix, Castle.viewMatrix, camPos);

    mat4.multiply(Castle.viewMatrix2, Castle.flipMatr, Castle.viewMatrix);

    mat4.multiply(Castle.viewProjMatr, Castle.projMatrix, Castle.viewMatrix2);

    var camForw = [Castle.viewMatrix2[2], Castle.viewMatrix2[6], Castle.viewMatrix2[10], 0];

    var camForwXY = [camForw[0], camForw[2]];

    vec2.normalize(camForwXY, camForwXY);

    var camRight = [Castle.viewMatrix2[0], Castle.viewMatrix2[4], Castle.viewMatrix2[8], 0];

    var camRightXY = [camRight[0], camRight[2]];

    vec2.normalize(camRightXY, camRightXY);

    Castle.camDeltaPos[0] -= (camForwXY[1] * Castle.cursorDeltaPos[0] - camRightXY[1] * Castle.cursorDeltaPos[1]) * 0.1;

    Castle.camDeltaPos[1] -= (camForwXY[0] * Castle.cursorDeltaPos[0] - camRightXY[0] * Castle.cursorDeltaPos[1]) * 0.1;

    Castle.camDeltaPos[0] = Castle.clamp(Castle.camDeltaPos[0], Castle.camDeltaPosMinMax[0][0], Castle.camDeltaPosMinMax[0][1]);

    Castle.camDeltaPos[1] = Castle.clamp(Castle.camDeltaPos[1], Castle.camDeltaPosMinMax[1][0], Castle.camDeltaPosMinMax[1][1]);

    mat4.invert(Castle.viewProjInv, Castle.viewProjMatr); // viewProj -> world

    Castle.cursorBasis = [
      ((Castle.cursorPosition[0] - Castle.canvasWidth / 2) / Castle.canvasWidth) * 2,
      -(((Castle.cursorPosition[1] - Castle.canvasHeight / 2) / Castle.canvasHeight) * 2),
      1,
      1,
    ];

    vec4.transformMat4(Castle.cursorBasis2, Castle.cursorBasis, Castle.viewProjInv);

    Castle.cursorBasis2[0] /= -Castle.cursorBasis2[3];

    Castle.cursorBasis2[1] /= -Castle.cursorBasis2[3];

    Castle.cursorBasis2[2] /= -Castle.cursorBasis2[3];

    var camForwNew = [Castle.cursorBasis2[0] - camPos[0], Castle.cursorBasis2[1] - camPos[1], Castle.cursorBasis2[2] - camPos[2]];

    vec3.normalize(camForwNew, camForwNew);

    // курсор ищем на высоте приподнятой сетки строительства — иначе клетка под курсором и нарисованная расходятся
    var t = -(camPos[1] + Castle.gridTranslationY + Castle.GRID_LIFT) / camForwNew[1];

    Castle.gridCursorPosX = camPos[0] + t * camForwNew[0] + (Castle.zeroTranslation[0] + Castle.gridTranslation[0]);

    Castle.gridCursorPosZ = camPos[2] + t * camForwNew[2] + (Castle.zeroTranslation[1] + Castle.gridTranslation[1]);

    Castle.UpdateBuildingBubbles();
  }
  static frameId = 0;

  // Uniform-ы, одинаковые у всех объектов кадра: программа получает их один раз за кадр
  // (до правки — на каждый объект, ~700 раз). В течение кадра камера, свет и время не меняются.
  static setupMainCam(program, l) {
    if (l.frame === Castle.frameId) return;
    l.frame = Castle.frameId;
    const gl = Castle.gl;

    gl.uniformMatrix4fv(l.mViewProj, false, Castle.viewProjMatr);

    gl.uniformMatrix4fv(l.lightViewProj, false, Castle.lightViewProjMatrix);

    gl.uniform4fv(l.sunLight, Castle.sunLight);

    gl.uniform4fv(l.ambientLight, Castle.ambientLight);

    gl.uniform4f(l.zNearFar, Castle.zNear, Castle.zFar, Castle.zNearSM, Castle.zFarSM);

    gl.uniform2f(l.cursorGrid, -Castle.gridCursorPosX, -Castle.gridCursorPosZ);

    gl.uniform4f(l.time, Castle.currentTime, 0, 0, 0);

    gl.uniform4f(l.shadowDebug, Castle.shadowDebugMode, 0, 0, 0);
  }

  static setupSMCam(program, l) {
    if (l.frame === Castle.frameId) return;
    l.frame = Castle.frameId;

    Castle.gl.uniformMatrix4fv(l.mViewProj, false, Castle.lightViewProjMatrix);

    Castle.gl.uniform4f(l.time, Castle.currentTime, 0, 0, 0);
  }

  static getBlendFunc(blendString) {
    switch (blendString) {
      case 'ZERO':
        return Castle.gl.ZERO;
        break;

      case 'ONE':
        return Castle.gl.ONE;
        break;

      case 'SRC_COLOR':
        return Castle.gl.SRC_COLOR;
        break;

      case 'ONE_MINUS_SRC_COLOR':
        return Castle.gl.ONE_MINUS_SRC_COLOR;
        break;

      case 'DST_COLOR':
        return Castle.gl.DST_COLOR;
        break;

      case 'ONE_MINUS_DST_COLOR':
        return Castle.gl.ONE_MINUS_DST_COLOR;
        break;

      case 'SRC_ALPHA':
        return Castle.gl.SRC_ALPHA;
        break;

      case 'ONE_MINUS_SRC_ALPHA':
        return Castle.gl.ONE_MINUS_SRC_ALPHA;
        break;

      case 'DST_ALPHA':
        return Castle.gl.DST_ALPHA;
        break;

      case 'ONE_MINUS_DST_ALPHA':
        return Castle.gl.ONE_MINUS_DST_ALPHA;
        break;

      case 'CONSTANT_COLOR':
        return Castle.gl.CONSTANT_COLOR;
        break;

      case 'ONE_MINUS_CONSTANT_COLOR':
        return Castle.gl.ONE_MINUS_CONSTANT_COLOR;
        break;

      case 'CONSTANT_ALPHA':
        return Castle.gl.CONSTANT_ALPHA;
        break;

      case 'ONE_MINUS_CONSTANT_ALPHA':
        return Castle.gl.ONE_MINUS_CONSTANT_ALPHA;
        break;

      case 'SRC_ALPHA_SATURATE':
        return Castle.gl.SRC_ALPHA_SATURATE;
        break;

      default:
        return Castle.gl.ONE;
        break;
    }
  }

  static fmod(dividend, divisor) {
    if (divisor === 0) {
      // Handle division by zero based on desired behavior (e.g., return NaN or throw an error)
      return NaN;
    }
    return dividend - Math.floor(dividend / divisor) * divisor;
  }

  // Постоянные значения и рабочие массивы drawObject (снаружи не менять)
  static ZEROS2 = new Float32Array(2);
  static ZEROS4 = new Float32Array(4);
  static ONES4 = new Float32Array([1, 1, 1, 1]);
  static AXIS_X = new Float32Array([1, 0, 0]);
  static AXIS_Y = new Float32Array([0, 1, 0]);
  static AXIS_Z = new Float32Array([0, 0, 1]);
  static DEFAULT_TRANSFORM = new Float32Array([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]);
  static _mWorld = new Float32Array(16);
  static _mWorld2 = new Float32Array(16);
  static _mWorld3 = new Float32Array(16);
  static _mRotX = new Float32Array(16);
  static _mRotY = new Float32Array(16);
  static _mRotZ = new Float32Array(16);

  static drawObject(
    program,
    textures,
    vertices,
    indexCount,
    vertStride,
    attributes,
    strip,
    transform,
    isSMPass,
    blend,
    tintColor,
    uvScale,
    uvScroll,
    objectRotation,
    rotation,
    translation,
    tintOverride,
    scaleOverride,
    isGrid,
    startFreqValue,
    endAmpValue,
    animDir,
  ) {
    if (blend) {
      Castle.gl.enable(Castle.gl.BLEND);

      Castle.gl.disable(Castle.gl.CULL_FACE);

      Castle.gl.blendEquation(Castle.gl.FUNC_ADD);

      Castle.gl.colorMask(true, true, true, false);

      Castle.gl.depthMask(false);

      Castle.gl.blendFunc(Castle.getBlendFunc(blend[0]), Castle.getBlendFunc(blend[1]));
    }

    Castle.gl.bindBuffer(Castle.gl.ARRAY_BUFFER, vertices);

    let attribOffset = 0;

    const l = Castle.programLocs(program);
    const attribLocations = Castle.attribLocations(program, l, attributes);

    for (let a = 0; a < attributes.length; a++) {
      const attribute = attributes[a];
      let attribLocation = attribLocations[a];

      // атрибута нет в программе (например, кости, если шейдер собран без VS_SKIN) — только сдвигаем смещение
      if (attribLocation < 0) {
        attribOffset += attribute.count * attribute.sizeElem;
        continue;
      }

      let attribType =
        attribute.sizeElem == 4 ? Castle.gl.FLOAT : attribute.sizeElem == 2 ? Castle.gl.UNSIGNED_SHORT : Castle.gl.UNSIGNED_BYTE;

      Castle.gl.vertexAttribPointer(
        attribLocation, // Attribute location
        attribute.count, // Number of elements per attribute
        attribType, // Type of elements
        Castle.gl.TRUE,
        vertStride, // Size of an individual vertex
        attribOffset, // Offset from the beginning of a single vertex to this attribute
      );

      Castle.gl.enableVertexAttribArray(attribLocation);

      attribOffset += attribute.count * attribute.sizeElem;
    }

    Castle.gl.bindTexture(Castle.gl.TEXTURE_2D, null);
    // Tell OpenGL state machine which program should be active.
    Castle.gl.useProgram(program.prog);

    isSMPass ? Castle.setupSMCam(program, l) : Castle.setupMainCam(program, l);

    let tintColorValue = tintOverride ? tintOverride : tintColor ? tintColor : Castle.ONES4;
    // радуга (аддитивная) видна только днём: гаснет к закату, появляется на рассвете
    if (!isSMPass && Castle.dayNightActive && /rainbow/.test(Castle.currentDrawObject?.meshName || '')) {
      const k = Castle.daylight * Castle.daylight;
      tintColorValue = [tintColorValue[0] * k, tintColorValue[1] * k, tintColorValue[2] * k, tintColorValue[3]];
    }

    const gl = Castle.gl;

    gl.uniform4fv(l.tintColor, tintColorValue);

    gl.uniform4fv(l.uvScale, uvScale ? uvScale : Castle.ONES4);

    // Свечения (аддитивное смешивание: огни, кристаллы, фонари) ночью не темнеют вместе со сценой
    if (!isSMPass) {
      const glowFloor =
        blend && blend[1] === 'ONE' && Settings.settings?.buildingLights !== false ? CastleLighting.nightLevel * Castle.glowNightFloor : 0;
      gl.uniform1f(l.emissive, glowFloor);
    }

    // Programmable vertex animation (time — общий для кадра, в setupMainCam/setupSMCam)
    gl.uniform4fv(l.startFreq, startFreqValue ? startFreqValue : Castle.ZEROS4);
    gl.uniform4fv(l.endAmp, endAmpValue ? endAmpValue : Castle.ZEROS4);
    gl.uniform4fv(l.animDirVertFreq, animDir ? animDir : Castle.ZEROS4);

    gl.uniform2fv(l.uvScroll, uvScroll ? uvScroll : Castle.ZEROS2);

    // матрицы — общие рабочие массивы (uniformMatrix4fv копирует значение), новые на каждый объект не нужны
    const worldMatrix = Castle._mWorld;
    mat4.identity(worldMatrix);

    if (objectRotation) {
      const rotX = Castle._mRotX;
      const rotY = Castle._mRotY;
      const rotZ = Castle._mRotZ;

      mat4.fromRotation(rotX, Castle.fmod(objectRotation[0] * Castle.currentTime, 360.0), Castle.AXIS_X);

      mat4.fromRotation(rotY, Castle.fmod(objectRotation[1] * Castle.currentTime, 360.0), Castle.AXIS_Y);

      mat4.fromRotation(rotZ, Castle.fmod(objectRotation[2] * Castle.currentTime, 360.0), Castle.AXIS_Z);

      mat4.mul(worldMatrix, rotX, worldMatrix);
      mat4.mul(worldMatrix, rotY, worldMatrix);
      mat4.mul(worldMatrix, rotZ, worldMatrix);
    }

    let transformMatrix = transform ? transform : Castle.DEFAULT_TRANSFORM;
    mat4.mul(worldMatrix, worldMatrix, transformMatrix);

    const worldMatrix2 = Castle._mWorld2;

    const worldMatrix3 = Castle._mWorld3;

    mat4.transpose(worldMatrix2, worldMatrix);

    if (rotation) {
      mat4.fromRotation(worldMatrix3, rotation, Castle.AXIS_Y);

      mat4.mul(worldMatrix2, worldMatrix3, worldMatrix2);
    }

    if (scaleOverride) {
      mat4.fromScaling(worldMatrix3, [scaleOverride, scaleOverride, scaleOverride]);

      mat4.mul(worldMatrix2, worldMatrix3, worldMatrix2);
    }

    if (translation) {
      worldMatrix2[12] += translation[0];

      worldMatrix2[13] += translation[1];

      worldMatrix2[14] += translation[2];
    }

    gl.uniformMatrix4fv(l.mWorld, false, worldMatrix2);

    // кости скиннинга (VS_SKIN): поза объекта (castleSkin.js — мольберт, питомцы), до первой позы — поза привязки
    if (l.bones) {
      gl.uniform4fv(l.bones, Castle.currentDrawObject?.bones || Castle.bindPoseBones());
    }

    // Номер текстуры сэмплера всегда один и тот же (tex0 — 0 и т. д.), в программе он сохраняется:
    // пишем только первый раз (как и раньше, пишется лишь для сэмплеров, у которых есть текстура).
    for (let i = 0; i < textures.length; ++i) {
      if (textures[i]) {
        gl.activeTexture(gl.TEXTURE0 + i);

        gl.bindTexture(gl.TEXTURE_2D, textures[i]);

        if (i >= 4) gl.uniform1i(Castle.getUniformLocation(program, 'tex' + i), i);
        else if (l.texUnit[i] !== i) {
          l.texUnit[i] = i;
          gl.uniform1i(l.tex[i], i);
        }
      }
    }

    if (!isSMPass) {
      gl.activeTexture(gl.TEXTURE0 + textures.length);

      gl.bindTexture(gl.TEXTURE_2D, Castle.depthTexture);

      if (l.smTextureUnit !== textures.length) {
        l.smTextureUnit = textures.length;
        gl.uniform1i(l.smTexture, textures.length);
      }
    }

    if (!isSMPass && isGrid) {
      Castle.gl.activeTexture(Castle.gl.TEXTURE0 + textures.length + 1);

      Castle.gl.bindTexture(Castle.gl.TEXTURE_2D, Castle.gridTexture);
      Castle.gl.texImage2D(
        Castle.gl.TEXTURE_2D,
        0,
        Castle.gl.RGBA,
        64,
        64,
        0,
        Castle.gl.RGBA,
        Castle.gl.UNSIGNED_BYTE,
        Castle.allowedToBuildGridTex,
      );

      let attribNameSM = 'gridTex';

      let texLocationSM = Castle.getUniformLocation(program, attribNameSM);

      Castle.gl.uniform1i(texLocationSM, textures.length + 1);

      Castle.gl.activeTexture(Castle.gl.TEXTURE0 + textures.length + 2);
      Castle.gl.bindTexture(Castle.gl.TEXTURE_2D, Castle.gridIdTexture);
      Castle.gl.texImage2D(Castle.gl.TEXTURE_2D, 0, Castle.gl.RGBA, 64, 64, 0, Castle.gl.RGBA, Castle.gl.UNSIGNED_BYTE, Castle.gridIdTex);
      Castle.gl.uniform1i(Castle.getUniformLocation(program, 'gridIdTex'), textures.length + 2);
    }

    if (isSMPass) {
      const id = (Castle.currentDrawObject && Castle.currentDrawObject.debugId) || 0;
      gl.uniform4f(l.smDebugColor, (id & 255) / 255, ((id >> 8) & 255) / 255, 1, 1);
    } else {
      // shadowDebug — общий для кадра, в setupMainCam
      if (Castle.shadowDebugMode && Castle.smColorTexture) {
        Castle.gl.activeTexture(Castle.gl.TEXTURE0 + textures.length + 2);
        Castle.gl.bindTexture(Castle.gl.TEXTURE_2D, Castle.smColorTexture);
        Castle.gl.uniform1i(Castle.getUniformLocation(program, 'smColor'), textures.length + 2);
      }
    }

    Castle.gl.drawArrays(strip ? Castle.gl.TRIANGLE_STRIP : Castle.gl.TRIANGLES, 0, indexCount);
  }

  static convertBuildingPosToViewCoord(posX, posY) {
    let viewPos = new Float32Array(4);
    let bubblePos = [
      Castle.zeroTranslation[0] + posX * 7, // тут тоже чёта не сошлось
      Castle.gridTranslationY + 30, // иконку повесим над зданием в 30 метрах
      Castle.zeroTranslation[1] - 130 + posY * 7, // не сошлись какие-то числа, пришлось подгонять
      1,
    ];
    let viewProjTransp = new Float32Array(16);
    mat4.transpose(viewProjTransp, Castle.viewProjMatr);
    vec4.transformMat4(viewPos, bubblePos, Castle.viewProjMatr);
    let output = [((viewPos[0] / viewPos[3] + 1) * Castle.canvasWidth) / 2, ((1 - viewPos[1] / viewPos[3]) * Castle.canvasHeight) / 2];
    //let output = [viewPos[0] / viewPos[3] * Castle.canvasWidth, viewPos[1] / viewPos[3] * Castle.canvasHeight, viewPos[2] / viewPos[3]];
    return output;
  }

  static buildingUniqueIdCounter = 0;

  static buildingBubbleStatuses = {};

  static SetBuildingNotification(buildingName, notificationStatus) {
    Castle.buildingBubbleStatuses[buildingName] = notificationStatus;
  }

  static UpdateBuildingBubbles() {
    // Добавить все новые здания
    for (let b = 0; b < Castle.placedBuildings.length; ++b) {
      if (!('uniqueId' in Castle.placedBuildings[b])) {
        Castle.placedBuildings[b].uniqueId = Castle.buildingUniqueIdCounter;
        Castle.buildingUniqueIdCounter++;
      }
    }
    // Удалить здания, которые уже удалены
    for (let uid in Castle.buildingBubblesDoms) {
      if (!Castle.placedBuildings.find((obj) => obj.uniqueId == uid)) {
        Castle.buildingBubbles.removeChild(Castle.buildingBubblesDoms[uid]);
        delete Castle.buildingBubblesDoms[uid];
      }
    }
    for (const building of Castle.placedBuildings) {
      const buildingName = Castle.buildings[building.id];
      if (buildingName in CastleBuildingsEvents) {
        if (!(building.uniqueId in Castle.buildingBubblesDoms)) {
          Castle.buildingBubblesDoms[building.uniqueId] = DOM(
            {
              domaudio: domAudioPresets.bigButton,
              style: ['castle_building_bubble'],
              event: ['click', () => CastleBuildingsEvents[buildingName]()],
            },
            DOM({
              tag: 'img',
              src: `content/icons/buildings/${buildingName}.png`,
            }),
          );
          Castle.buildingBubbles.appendChild(Castle.buildingBubblesDoms[building.uniqueId]);
        }
        const doShowBubble = buildingName in Castle.buildingBubbleStatuses && Castle.buildingBubbleStatuses[buildingName];
        Castle.buildingBubblesDoms[building.uniqueId].style.display = doShowBubble ? 'block' : 'none';
        if (doShowBubble) {
          const buildingSize = Castle.sceneBuildings[buildingName].size[0];
          const buldingViewPos = Castle.convertBuildingPosToViewCoord(building.posX + buildingSize / 2, building.posY + buildingSize / 2);
          Castle.buildingBubblesDoms[building.uniqueId].style.left = buldingViewPos[0] + 'px';
          Castle.buildingBubblesDoms[building.uniqueId].style.top = buldingViewPos[1] + 'px';
        }
      }
    }
  }
}
