/**
 * Формат:
 * - `talents`: массив id талантов, где первый id — основной талант (main).
 * - в описании сета используется описание и название основного таланта.
 * - setId_1 отображается последним в списке сетов, то-есть новые сеты, добавленные в конец списка, всегда отображаются первыми.
 * - `testOnly`: сет из талантов, которые пока видит только тестовый клиент (уровень 11…66 в БД):
 *   показывается, только когда главный талант есть в справочнике библиотеки.
 * - `cdMods`: необязательное правило изменения КД отдельных талантов сета.
 *   Формат:
 *   cdMods: {
 *     [targetTalentId]: {
 *       [sourceTalentId]: [deltaSeconds], // отрицательное значение уменьшает КД
 *       bySetCount: {                      // по количеству талантов сета (включая targetTalentId)
 *         [needCount]: [deltaSeconds],
 *       },
 *     },
 *   }
 */

export const TALENT_SETS = {
  // extracted from `content/lang/en.js` (Set marker in descriptions)
  setId_1: {
    talents: [288, 299, 307],
  },
  setId_2: {
    talents: [290, 294, 300, 310],
  },
  setId_3: {
    talents: [298, 291, 292, 311],
  },
  setId_4: {
    talents: [301, 289, 295],
  },
  setId_5: {
    talents: [304, 296, 302, 309, 312],
  },
  setId_6: {
    talents: [306, 293, 297, 303, 308],
	cdMods: {
	  306: {303: [-30]}
	},
  },
  setId_7: {
    talents: [314, 318, 326],
	cdMods: {
	  314: {326: [-40]}
	},
  },
  setId_8: {
    talents: [319, 320, 323, 334],
  },
  setId_9: {
    talents: [321, 317, 335],
	cdMods: {
	  321: {317: [-40]}
	},
  },
  setId_10: {
    talents: [322, 316, 328],
  },
  setId_11: {
    talents: [325, 313, 329],
  },
  setId_12: {
    talents: [327, 305, 315],
	cdMods: {
	  327: {305: [-40]}
	},
  },
  setId_13: {
    talents: [330, 333, 336],
  },
  setId_14: {
    talents: [332, 324, 331, 337],
	cdMods: {
	  332: {331: [-80]}
	},
  },
  setId_15: {
    talents: [338, 343, 344, 345, 346],
  },
  setId_16: {
    talents: [339, 347, 348, 349, 350],
  },
  setId_17: {
    talents: [340, 351, 352, 353, 354, 355],
  },
  setId_18: {
    talents: [341, 356, 357, 358, 359, 360],
  },
  setId_19: {
    talents: [342, 361, 362, 363, 364, 365],
  },
  setId_20: {
    talents: [429, 430, 431, 432, 608, 433, 434, 766, 767],
  },
  setId_21: {
    talents: [435, 436, 437, 438, 439],
	addStats: {
	  2: { sr: 6 },
      3: { ph: 6 },
	},
  },
  setId_22: {
    talents: [448, 447, 449, 450, 451, 452],
	addStats: {
      4: { sr: 8 },
	},
  },
  setId_23: {
    talents: [458, 454, 455, 456, 457],
  },
  setId_24: {
    talents: [461, 459, 460, 462, 463],
	cdMods: {
	  461: {459: [-30]}
	},
  },
  setId_25: {
    talents: [464, 465, 466, 467],
	addStats: {
      3: { sv: 8 },
	},
  },
  setId_26: {
    talents: [470, 468, 469, 471],
	cdMods: {
	  470: {469: [-30]}
	},
  },
  setId_27: {
    talents: [473, 472, 474, 475, 476],
	cdMods: {
	  473: {472: [-30]}
	},
  },
  setId_28: {
    talents: [479, 477, 478, 732],
	addStats: {
      2: { sr: 4 },
	},
  },
  setId_29: {
    talents: [480, 481, 482, 483, 484],
  },
  setId_30: {
    talents: [485, 486, 487, 488, 489],
  },
  setId_31: {
    talents: [490, 491, 492, 493, 494],
	cdMods: {
	  490: {493: [-30]}
	},
  },
  setId_32: {
    talents: [495, 496, 497, 498, 499, 500],
  },
  setId_33: {
    talents: [501, 502, 503, 504, 505],
	cdMods: {
	  501: {504: [-30]}
	},
  },
  setId_34: {
    talents: [506, 507, 508, 509, 510, 511],
  },
  setId_35: {
    talents: [512, 513, 514, 515, 516],
	cdMods: {
	  512: {514: [-60]}
	},
  },
  setId_36: {
    talents: [517, 518, 519, 520, 521, 544],
	cdMods: {
	  517: {521: [-60]}
	},
  },
  setId_37: {
    talents: [522, 523, 524, 525, 526, 527, 545],
  },
  setId_38: {
    talents: [528, 529, 530, 531, 532, 546],
  },
  setId_39: {
    talents: [533, 534, 535, 536, 537, 547],
  },
  setId_40: {
    talents: [538, 539, 540, 541, 542, 543, 548],
  },
  setId_41: {
    talents: [549, 550, 551, 552, 553, 579],
	cdMods: {
	  549: {553: [-45]}
	},
  },
  setId_42: {
    talents: [554, 555, 556, 557, 558, 580],
  },
  setId_43: {
    talents: [559, 560, 561, 562, 563, 581],
  },
  setId_44: {
    talents: [564, 565, 566, 567, 568],
  },
  setId_45: {
    talents: [569, 570, 571, 572, 573, 583],
  },
  setId_46: {
    talents: [578, 577, 576, 575, 574],
	addStats: {
      2: { sila: 2, razum: 2, provorstvo: 2, hitrost: 2, stoikost: 2, volia: 2 },
	  4: { sila: 2, razum: 2, provorstvo: 2, hitrost: 2, stoikost: 2, volia: 2 },
	},
  },
  setId_47: {
    talents: [584, 585, 586, 587],
	addStats: {
      3: { sr: 6 },
	},
  },
  setId_48: {
    talents: [588, 589, 590, 591],
	addStats: {
      2: { sv: 6 },
	},
  },
  setId_49: {
    talents: [592, 593, 594, 595],
	addStats: {
      2: { razum: 7 },
	},
  },
  setId_50: {
    talents: [596, 597, 598, 599],
	addStats: {
      2: { sila: 7 },
	},
  },
  setId_51: {
    talents: [600, 601, 602, 603],
	addStats: {
      3: { sr: 6 },
	},
  },
  setId_52: {
    talents: [604, 605, 606, 607],
	addStats: {
      2: { krajahp: 5 },
	},
  },
  setId_53: {
    talents: [609, 610, 611, 612, 613],
	addStats: {
      1: { speedtal: 5 },
	  2: { speedtal: 6 },
	  3: { speedtal: 7 },
	  4: { speedtal: 8 },
	},
  },
  setId_54: {
    talents: [614, 615, 616, 617, 618],
	cdMods: {
	  614: {615: [-15]}
	},
  },
  setId_55: {
    talents: [619, 620, 621, 622],
  },
  setId_56: {
    talents: [624, 623, 625, 626],
	addStats: {
      2: { speedtal: 6 },
	},
	cdMods: {
	  624: {
	  	bySetCount: {
	  	  3:[-80],
	  	},
	  },
	},
  },
  setId_57: {
    talents: [628, 627, 629, 630],
	addStats: {
      2: { sv: 6 },
	},
  },
  setId_58: {
    talents: [632, 631, 633, 634],
	addStats: {
      2: { ph: 6 },
	},
	cdMods: {
	  632: {
	  	bySetCount: {
	  	  2:[-45],
	  	},
	  },
	},	
  },
  setId_59: {
    talents: [638, 635, 636, 637],
	addStats: {
      2: { sr: 6 },
	},
  },
  setId_60: {
    talents: [639, 640, 641, 642, 643, 644],
	addStats: {
      2: { sr: 6 },
	},
  },
  setId_61: {
    talents: [654, 651, 652, 653],
	addStats: {
      2: { srrz: 8 },
	},
  },
  setId_62: {
    talents: [658, 655, 656, 657],
	addStats: {
      2: { svrz: 8 },
	},
  },
  setId_63: {
    talents: [662, 659, 660, 661],
	addStats: {
      2: { srrz: 8 },
	},
  },
  setId_64: {
    talents: [663, 664, 665],
  },
  setId_65: {
    talents: [669, 666, 667, 668],
	addStats: {
      2: { sr: 8 },
	},
  },
  setId_66: {
    talents: [673, 670, 671, 672],
	addStats: {
      2: { ph: 8 },
	},
  },
  setId_67: {
    talents: [674, 675, 676, 677, 678, 679],
	addStats: {
      2: { sr: 6 },
	},
  },
  setId_68: {
    talents: [684, 680, 681, 682, 683, 685],
	addStats: {
      2: { sr: 8 },
	},
  },
  setId_69: {
    talents: [686, 687, 688, 689],
	addStats: {
      2: { crit: 3 },
    },
  },
  setId_70: {
    talents: [690, 691, 692, 693],
	addStats: {
      2: { speedtal: 6 },
    },
  },
  setId_71: {
    talents: [694, 695, 696, 697],
  },
  setId_72: {
    talents: [698, 699, 700, 701],
  },
  setId_73: {
    talents: [702, 703, 704, 705],
  },
  setId_74: {
    talents: [706, 707, 708, 709],
  },
  setId_75: {
    talents: [710, 711, 712, 713, 714, 715, 716],
  },
  setId_76: {
    talents: [717, 718, 719, 720, 721, 722],
  },
  setId_77: {
    talents: [728, 724, 725, 726, 727, 729, 730, 731],
    addStats: {
      2: { speeda: 2 },
    },
  },
  setId_78: {
    talents: [733, 734, 735, 736, 737, 738, 739],
  },
  setId_79: {
    talents: [741, 742, 743, 744, 745, 746, 747, 748],
	cdMods: {
	  741: {746: [-20], 747: [-20]}
	},
  },
  setId_80: {
    talents: [752, 750, 751, 753, 754, 755, 756],
	addStats: {
		2: {speedd: 1},
		3: {speedd: 1},
		4: {speedd: 1},
	},
	mainNeed: 752,
  },
  setId_81: {
    talents: [757, 758, 759, 760, 761],
	cdMods: {
	  757: {758: [-20]}
	},
  },
  setId_82: {
    talents: [764, 442, 443, 444, 445, 446],
	addStats: {
      3: { sr: 7 },
    },
  },
  setId_83: {
    talents: [17, 63, 72, 155, 160, 194, 195, 201, 202],
    addStats: {
      2: { sr: 8 },
      3: { ph: 8 },
      4: { sv: 8 },
	},
  },
  setId_84: {
    talents: [200, 215, 277],
    addStats: {
      2: { sr: 8 },
      3: { sr: 16 },
    },
  },
  setId_85: {
    talents: [768, 769, 770, 771, 772, 773],
  },
  setId_86: {
    talents: [774, 775, 776, 777],
	cdMods: {
	  774: {777: [-20]}
	},
  },
  setId_87: {
    talents: [778, 779, 780, 781, 782],
    testOnly: true,
  },
};

