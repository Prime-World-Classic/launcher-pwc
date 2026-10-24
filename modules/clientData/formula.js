// Формулы данных игры (<sString> в .xdb) — тот же язык, что компилирует клиент:
// C++-выражение плюс слой подстановок FormulaBuilder::PrepareCFile
// (Prime-World Src/FormulaBuilder/FormulaBuilder.cpp, переносимая VM — Src/System/FormulaVM.cpp):
//   sX / rX      — стат героя-владельца / цели (GetX()), sIsX / rIsX — IsX();
//   mX / mIsX    — поле таланта (IMiscFormulaPars: RefineRate, TalentLevel, ManaCost…);
//   cX           — константа таланта (своя или глобальная из AILogic.AILP);
//   .vX / .cX / .oX / .applX(T) / .Name / .lower. — члены объектов (sender., receiver., appl.);
//   макросы FormulaPars.h: refineScale, abilityScale*, damageScale*, tal, talconst, nt, s(), r(), …
// Типы как в C++: целое деление остаётся целым, floor/ceil и т. п. считаются в double.
// Чего в лаунчере нет (вероятности, переменные боя, аппликаторы), вычисляется нулём / false
// и попадает в ctx.unknown — по нему видно, какие значения подсказки приблизительны.

const T_INT = 'i';
const T_FLT = 'f';
const T_BOOL = 'b';
const T_PTR = 'p';

// Аксессоры с целым результатом (FormulaPars.h, остальные — float)
const INT_ACCESSORS = new Set([
  'TerrainType', 'UnitKind', 'NativeDefenceIndex', 'NativeAttackIndex', 'DevPoints', 'ZZimaSex',
  'NaftaSpecForKill', 'NaftaForKill', 'NaftaForAssist', 'TeamNaftaForKill', 'TeamNaftaForPresence',
  'NaftaLevel', 'Nafta', 'TotalNaftaEarned', 'Fctn', 'OriginalFctn', 'WOID', 'EffectiveClassMask',
  'KillStreak', 'DeathStreak', 'AssistersCount', 'SpecCount', 'PresentTeamActiveMembers',
  'Rank', 'AbilityType', 'RefineRate', 'TalentLevel', 'TalentDevPoints', 'NaftaCost', 'ScrollLevel',
  'AlternativeTargetIndex', 'ActivatedWithinKit', 'TalentsWithinKit', 'TerrianTypeUnderCursor',
]);
const BOOL_ACCESSORS = new Set(['IsMale', 'IsMoving', 'IsHero', 'OnBase', 'IsAbilityOn', 'IsTalentBought', 'IsNight', 'IsEvading']);

// Перечисления, которые встречаются в формулах (FormulaPars.h)
const ENUMS = {
  TERR_N: 0, TERR_A: 1, TERR_B: 2, FCTN_N: 0, FCTN_A: 1, FCTN_B: 2,
  UNITCHECKID_ISHERO: 0, UNITCHECKID_ISBUILDING: 1,
  GLOBAL: 0, UNIT: 1, ABILITY: 2, DISPATCH: 3, UNIT_AND_SUMMONS: 4,
  BASE_ATTACK: -1, ABILITY0: 0, ABILITY1: 1, ABILITY2: 2, ABILITY3: 3, ABILITY4: 4,
  PROTECTOR: 1, VANGUARD: 2, EXECUTIONER: 4, FIGHTER: 8, SUPPORT: 16,
  ABILITYTYPE_SIMPLE: 0, ABILITYTYPE_ACTIVE: 1, ABILITYTYPE_MULTIACTIVE: 2, ABILITYTYPE_PASSIVE: 3,
  ABILITYTYPE_AUTOCASTABLE: 4, ABILITYTYPE_SWITCHABLE: 5, ABILITYTYPE_CHANNELLING: 6,
  ZZSEX_UNDEFINED: 0, ZZSEX_MALE: 1, ZZSEX_FEMALE: 2,
  NULL: 0,
};

// Масштабирующие макросы: [isDamage, режим (0 — стат, 1 — здоровье, 2 — энергия), аксессор стата или null]
const SCALES = {
  abilityScale: [false, 0, null],
  damageScale: [true, 0, null],
  abilityScaleCustomLife: [false, 1, null],
  abilityScaleCustomEnergy: [false, 2, null],
  damageScaleCustomLife: [true, 1, null],
  damageScaleCustomEnergy: [true, 2, null],
  abilityScaleLife: [false, 1, 'Life'],
  abilityScaleEnergy: [false, 2, 'Energy'],
  abilityScaleMaxLife: [false, 1, 'MaxLife'],
  abilityScaleMaxEnergy: [false, 2, 'MaxEnergy'],
};

// ---------------------------------------------------------------------------------------------
// Лексер

const PUNCT = ['->', '::', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>'];

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([fF]?)/.exec(src.slice(i));
      const text = m[0];
      const body = m[1] ? text.slice(0, -1) : text;
      const isInt = !m[1] && /^(0[xX][0-9a-fA-F]+|\d+)$/.test(body);
      tokens.push({ k: 'num', v: Number(body), t: isInt ? T_INT : T_FLT });
      i += text.length;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[$]?[A-Za-z_][A-Za-z_0-9]*/.exec(src.slice(i));
      tokens.push({ k: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      tokens.push({ k: 'str', v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (PUNCT.includes(two)) {
      tokens.push({ k: 'p', v: two });
      i += 2;
      continue;
    }
    tokens.push({ k: 'p', v: ch });
    i++;
  }
  tokens.push({ k: 'end', v: '' });
  return tokens;
}

// ---------------------------------------------------------------------------------------------
// Парсер: AST-узлы { op, ...; t } — t — статический тип результата (как в C++)

const BINARY = [
  ['||'],
  ['&&'],
  ['|'],
  ['^'],
  ['&'],
  ['==', '!='],
  ['<', '<=', '>', '>='],
  ['<<', '>>'],
  ['+', '-'],
  ['*', '/', '%'],
];

function arithType(a, b) {
  return a === T_FLT || b === T_FLT ? T_FLT : T_INT;
}

class Parser {
  constructor(src) {
    this.tokens = tokenize(src);
    this.pos = 0;
  }

  get cur() {
    return this.tokens[this.pos];
  }

  peek(offset = 1) {
    return this.tokens[this.pos + offset];
  }

  isP(value) {
    return this.cur.k === 'p' && this.cur.v === value;
  }

  eat(value) {
    if (this.isP(value)) {
      this.pos++;
      return true;
    }
    return false;
  }

  expect(value) {
    if (!this.eat(value)) throw new Error(`ожидалось '${value}', встречено '${this.cur.v}'`);
  }

  parse() {
    const node = this.expr();
    if (this.cur.k !== 'end') throw new Error(`лишнее после выражения: '${this.cur.v}'`);
    return node;
  }

  // оператор запятой C++ встречается только в аргументах — здесь не нужен
  expr() {
    return this.ternary();
  }

  ternary() {
    const cond = this.binary(0);
    if (!this.eat('?')) return cond;
    const a = this.expr();
    this.expect(':');
    const b = this.ternary();
    return { op: '?:', cond, a, b, t: a.t === b.t ? a.t : arithType(a.t, b.t) };
  }

  binary(level) {
    if (level >= BINARY.length) return this.unary();
    let left = this.binary(level + 1);
    for (;;) {
      const op = this.cur.k === 'p' && BINARY[level].includes(this.cur.v) ? this.cur.v : null;
      if (!op) return left;
      this.pos++;
      const right = this.binary(level + 1);
      let t;
      if (['||', '&&', '==', '!=', '<', '<=', '>', '>='].includes(op)) t = T_BOOL;
      else if (['|', '^', '&', '<<', '>>', '%'].includes(op)) t = T_INT;
      else t = arithType(left.t, right.t);
      left = { op, a: left, b: right, t };
    }
  }

  unary() {
    if (this.eat('!')) return { op: '!', a: this.unary(), t: T_BOOL };
    if (this.eat('-')) {
      const a = this.unary();
      return { op: 'neg', a, t: a.t === T_FLT ? T_FLT : T_INT };
    }
    if (this.eat('+')) return this.unary();
    if (this.eat('~')) return { op: '~', a: this.unary(), t: T_INT };
    // приведение типа (int)x / (float)x / (bool)x
    if (this.isP('(') && this.peek().k === 'id' && ['int', 'float', 'double', 'bool', 'unsigned'].includes(this.peek().v) && this.peek(2).v === ')') {
      const type = this.peek().v;
      this.pos += 3;
      const a = this.unary();
      return { op: 'cast', a, t: type === 'bool' ? T_BOOL : type === 'int' || type === 'unsigned' ? T_INT : T_FLT };
    }
    return this.postfix(this.primary());
  }

  args() {
    const list = [];
    if (this.eat(')')) return list;
    do list.push(this.expr());
    while (this.eat(','));
    this.expect(')');
    return list;
  }

  postfix(node) {
    for (;;) {
      if (this.isP('.') || this.isP('->')) {
        this.pos++;
        const name = this.cur.v;
        if (this.cur.k !== 'id') throw new Error('после . ожидается имя');
        this.pos++;
        const call = this.eat('(');
        node = this.member(node, name, call ? this.args() : null);
        continue;
      }
      return node;
    }
  }

  member(obj, name, args) {
    const upper = (index) => /[A-Z]/.test(name[index] || '');
    if (!args && name[0] === 'v' && upper(1)) return { op: 'var', obj, name: name.slice(1), t: T_FLT };
    if (!args && name[0] === 'c' && upper(1)) return { op: 'const', obj, name: name.slice(1), t: T_FLT };
    if (name[0] === 'o' && upper(1)) return { op: 'object', obj, name: name.slice(1), t: T_PTR };
    if (args && name.startsWith('appl') && upper(4)) return { op: 'appl', obj, name: name.slice(4), t: T_PTR };
    if (args) {
      const method = name.startsWith('Get') ? name.slice(3) : name;
      return { op: 'method', obj, name: method, args, t: accessorType(method) };
    }
    if (/[a-z]/.test(name[0])) return { op: 'object', obj, name: name[0].toUpperCase() + name.slice(1), t: T_PTR };
    return { op: 'method', obj, name, args: [], t: accessorType(name) };
  }

  primary() {
    const tok = this.cur;
    if (tok.k === 'num') {
      this.pos++;
      return { op: 'num', v: tok.v, t: tok.t };
    }
    if (tok.k === 'str') {
      this.pos++;
      return { op: 'str', v: tok.v, t: T_PTR };
    }
    if (this.eat('(')) {
      const node = this.expr();
      this.expect(')');
      return node;
    }
    if (tok.k !== 'id') throw new Error(`неожиданный символ '${tok.v}'`);
    this.pos++;
    const name = tok.v;
    if (name[0] === '$') return this.dollar(name.slice(1));
    const call = this.isP('(');
    if (call) this.pos++;
    const args = call ? this.args() : null;
    return this.identifier(name, args);
  }

  dollar(name) {
    if (name === 'ParentApplVariable') {
      this.expect('(');
      const arg = this.cur.v;
      this.pos++;
      this.expect(')');
      return { op: 'unknown', name: `$ParentApplVariable(${arg})`, t: T_FLT };
    }
    if (name === 'IsAppliedOnSelf') return { op: 'selfcheck', t: T_BOOL };
    return { op: 'unknown', name: `$${name}`, t: T_PTR };
  }

  identifier(name, args) {
    const upper = (index) => /[A-Z]/.test(name[index] || '');
    if (name === 'true' || name === 'false') return { op: 'num', v: name === 'true' ? 1 : 0, t: T_BOOL };
    if (name in ENUMS && !args) {
      // Enum::VALUE
      return { op: 'num', v: ENUMS[name], t: T_INT };
    }
    if (!args && this.isP('::')) {
      this.pos++;
      const sub = this.cur.v;
      this.pos++;
      return { op: 'num', v: ENUMS[sub] ?? 0, t: T_INT };
    }
    if (['pFirst', 'sender'].includes(name)) return { op: 'unit', who: 'first', t: T_PTR };
    if (['pSecond', 'receiver'].includes(name)) return { op: 'unit', who: 'second', t: T_PTR };
    if (['pMisc', 'appl'].includes(name)) return { op: 'misc', t: T_PTR };
    if (args) return this.call(name, args);

    if (/^[sr]Is[A-Z]/.test(name)) return { op: 'method', obj: { op: 'unit', who: name[0] === 's' ? 'first' : 'second', t: T_PTR }, name: name.slice(1), args: [], t: T_BOOL };
    if (/^mIs[A-Z]/.test(name)) return { op: 'method', obj: { op: 'misc', t: T_PTR }, name: name.slice(1), args: [], t: T_BOOL };
    if ((name[0] === 's' || name[0] === 'r') && upper(1)) {
      return { op: 'method', obj: { op: 'unit', who: name[0] === 's' ? 'first' : 'second', t: T_PTR }, name: name.slice(1), args: [], t: accessorType(name.slice(1)) };
    }
    if (name[0] === 'm' && upper(1)) return { op: 'method', obj: { op: 'misc', t: T_PTR }, name: name.slice(1), args: [], t: accessorType(name.slice(1)) };
    if (name[0] === 'c' && upper(1)) return { op: 'const', obj: null, name: name.slice(1), t: T_FLT };
    return { op: 'unknown', name, t: T_FLT };
  }

  call(name, args) {
    if (SCALES[name]) {
      const [isDamage, mode, accessor] = SCALES[name];
      const stat = accessor ? { op: 'method', obj: { op: 'unit', who: 'first', t: T_PTR }, name: accessor, args: [], t: T_FLT } : args.shift();
      return { op: 'scale', isDamage, mode, stat, args, t: T_FLT };
    }
    switch (name) {
      case 'refineScale':
        return { op: 'refine', args: args.slice(0, 2), t: T_FLT };
      case 'tal':
      case 'mastertal':
        return { op: 'tal', name, args, t: T_BOOL };
      case 'talconst':
      case 'talconstNoCheck':
      case 'stalconst':
      case 'mastertalconst':
      case 'smastertalconst':
      case 'getTalentRefineRate':
        return { op: 'talconst', name, args, t: name === 'getTalentRefineRate' ? T_INT : T_FLT };
      case 'nt':
      case 'nativeTerrain':
        return { op: 'nt', args, t: arithType(args[0]?.t, args[1]?.t) };
      case 's':
      case 'SwitchByBool':
        return { op: '?:', cond: args[0], a: args[1], b: args[2], t: T_FLT };
      case 'r':
        return { op: 'rank', args, t: T_FLT };
      case 'ut_hero':
      case 'ut_bldg':
        return { op: 'unitcheck', check: name === 'ut_hero' ? 0 : 1, args, t: T_FLT };
      case 'roll':
      case 'random':
      case 'smartRoll':
      case 'smartRandom':
        return { op: 'chance', name, args, t: name === 'roll' ? T_FLT : name === 'smartRoll' ? T_BOOL : T_INT };
      case 'sFlag':
      case 'rFlag':
        return { op: 'unknown', name, t: T_BOOL };
      default:
        return { op: 'fn', name, args, t: FN_TYPES[name] ?? T_FLT };
    }
  }
}

const FN_TYPES = { f2l: T_INT, f2l_sse3: T_INT, isinbounds: T_BOOL };

function accessorType(name) {
  if (INT_ACCESSORS.has(name)) return T_INT;
  if (BOOL_ACCESSORS.has(name) || /^Is[A-Z]/.test(name)) return T_BOOL;
  return T_FLT;
}

// ---------------------------------------------------------------------------------------------
// Вычисление

function toInt(value) {
  return Math.trunc(Number(value) || 0);
}

function niRound(value) {
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

const FUNCTIONS = {
  min: (a, b) => (a < b ? a : b),
  max: (a, b) => (a > b ? a : b),
  clamp: (a, b, c) => Math.min(Math.max(a, b), c),
  lerp: (p, a, b) => a * (1 - p) + b * p,
  isinbounds: (x, l, r) => l <= x && x <= r,
  round: niRound,
  f2l: toInt,
  f2l_sse3: toInt,
  floor: Math.floor,
  ceil: Math.ceil,
  fabs: Math.abs,
  abs: Math.abs,
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  pow: Math.pow,
  fmod: (a, b) => a % b,
  t: (index, neutral, a, b) => [neutral, a, b][toInt(index)] ?? 0,
  SwitchByAbilityRank: (rank, a, b, c, d) => [0, a, b, c, d][toInt(rank)] ?? 0,
};

function num(value) {
  if (value === true) return 1;
  if (value === false || value == null) return 0;
  return typeof value === 'number' ? value : 0;
}

function evaluate(node, ctx) {
  switch (node.op) {
    case 'num':
      return node.v;
    case 'str':
      return node.v;
    case '?:':
      return truthy(evaluate(node.cond, ctx)) ? evaluate(node.a, ctx) : evaluate(node.b, ctx);
    case '||':
      return truthy(evaluate(node.a, ctx)) || truthy(evaluate(node.b, ctx));
    case '&&':
      return truthy(evaluate(node.a, ctx)) && truthy(evaluate(node.b, ctx));
    case '==':
    case '!=': {
      const a = evaluate(node.a, ctx);
      const b = evaluate(node.b, ctx);
      const pointer = node.a.t === T_PTR || node.b.t === T_PTR;
      const same = pointer ? (a || null) === (b || null) : num(a) === num(b);
      return node.op === '==' ? same : !same;
    }
    case '<':
      return num(evaluate(node.a, ctx)) < num(evaluate(node.b, ctx));
    case '<=':
      return num(evaluate(node.a, ctx)) <= num(evaluate(node.b, ctx));
    case '>':
      return num(evaluate(node.a, ctx)) > num(evaluate(node.b, ctx));
    case '>=':
      return num(evaluate(node.a, ctx)) >= num(evaluate(node.b, ctx));
    case '+':
    case '-':
    case '*':
    case '/': {
      const a = num(evaluate(node.a, ctx));
      const b = num(evaluate(node.b, ctx));
      if (node.op === '+') return node.t === T_INT ? toInt(a + b) : a + b;
      if (node.op === '-') return node.t === T_INT ? toInt(a - b) : a - b;
      if (node.op === '*') return node.t === T_INT ? toInt(a * b) : a * b;
      if (node.t === T_INT) return b === 0 ? 0 : toInt(a / b);
      return a / b;
    }
    case '%': {
      const b = toInt(evaluate(node.b, ctx));
      return b === 0 ? 0 : toInt(evaluate(node.a, ctx)) % b;
    }
    case '|':
      return toInt(evaluate(node.a, ctx)) | toInt(evaluate(node.b, ctx));
    case '&':
      return toInt(evaluate(node.a, ctx)) & toInt(evaluate(node.b, ctx));
    case '^':
      return toInt(evaluate(node.a, ctx)) ^ toInt(evaluate(node.b, ctx));
    case '<<':
      return toInt(evaluate(node.a, ctx)) << toInt(evaluate(node.b, ctx));
    case '>>':
      return toInt(evaluate(node.a, ctx)) >> toInt(evaluate(node.b, ctx));
    case '!':
      return !truthy(evaluate(node.a, ctx));
    case '~':
      return ~toInt(evaluate(node.a, ctx));
    case 'neg':
      return -num(evaluate(node.a, ctx));
    case 'cast': {
      const value = evaluate(node.a, ctx);
      if (node.t === T_BOOL) return truthy(value);
      return node.t === T_INT ? toInt(num(value)) : num(value);
    }
    case 'unit':
      return ctx.unit(node.who);
    case 'misc':
      return ctx.misc();
    case 'method': {
      const obj = evaluate(node.obj, ctx);
      const args = node.args.map((arg) => evaluate(arg, ctx));
      const value = ctx.call(obj, node.name, args);
      if (node.t === T_INT) return toInt(num(value));
      if (node.t === T_BOOL) return truthy(value);
      return value;
    }
    case 'var':
      return ctx.variable(node.obj ? evaluate(node.obj, ctx) : null, node.name);
    case 'const':
      return ctx.constant(node.name, node.obj ? evaluate(node.obj, ctx) : null);
    case 'object':
      return ctx.object(evaluate(node.obj, ctx), node.name);
    case 'appl':
      ctx.unknown?.add(`appl${node.name}`);
      return null;
    case 'scale': {
      const stat = num(evaluate(node.stat, ctx));
      const [left, right, round] = node.args.map((arg) => evaluate(arg, ctx));
      return ctx.scale(node.isDamage, node.mode, stat, num(left), num(right), round === undefined ? true : truthy(round));
    }
    case 'refine': {
      const [a, b] = node.args.map((arg) => num(evaluate(arg, ctx)));
      return a + b * (ctx.refineRate() - 1);
    }
    case 'tal':
      return ctx.hasTalent(String(evaluate(node.args[0], ctx)), node.name === 'mastertal');
    case 'talconst': {
      const id = String(evaluate(node.args[0], ctx));
      if (node.name === 'getTalentRefineRate') {
        const rate = ctx.talentRefineRate(id);
        return rate == null ? num(evaluate(node.args[1], ctx)) : rate;
      }
      const name = String(evaluate(node.args[1], ctx));
      const check = node.name !== 'talconstNoCheck';
      if (check && !ctx.hasTalent(id, node.name.includes('master'))) {
        return node.args[2] ? num(evaluate(node.args[2], ctx)) : 0;
      }
      const value = ctx.talentConstant(id, name);
      return value == null ? 0 : value;
    }
    case 'nt':
      return ctx.nativeTerrain() ? evaluate(node.args[0], ctx) : evaluate(node.args[1], ctx);
    case 'rank': {
      const rank = toInt(ctx.call(ctx.misc(), 'Rank', []));
      return rank >= 1 && rank <= node.args.length ? evaluate(node.args[rank - 1], ctx) : 0;
    }
    case 'unitcheck':
      return truthy(ctx.call(ctx.unit('second'), 'UnitCheck', [node.check])) ? evaluate(node.args[0], ctx) : evaluate(node.args[1], ctx);
    case 'chance':
      ctx.unknown?.add(node.name);
      return node.name === 'roll' && node.args.length > 2 ? evaluate(node.args[2], ctx) : 0;
    case 'selfcheck':
      return true;
    case 'fn': {
      const fn = FUNCTIONS[node.name];
      if (!fn) {
        ctx.unknown?.add(`${node.name}()`);
        return 0;
      }
      const value = fn(...node.args.map((arg) => num(evaluate(arg, ctx))));
      return node.t === T_INT ? toInt(value) : value;
    }
    case 'unknown':
      ctx.unknown?.add(node.name);
      return node.t === T_PTR ? null : 0;
    default:
      throw new Error(`узел ${node.op}`);
  }
}

function truthy(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'object') return true;
  return !!value;
}

// ---------------------------------------------------------------------------------------------

const cache = new Map();

export function compileFormula(src) {
  // «x; // комментарий» — в C++-функцию формула вставляется как `return <формула>;`,
  // поэтому лишняя ';' и комментарии C++ в контенте безвредны
  const key = String(src ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .trim()
    .replace(/;+\s*$/, '');
  if (cache.has(key)) return cache.get(key);
  let compiled;
  try {
    compiled = key ? { ast: new Parser(key).parse(), error: null } : { ast: { op: 'num', v: 0, t: T_FLT }, error: null };
  } catch (error) {
    compiled = { ast: null, error: error.message };
  }
  cache.set(key, compiled);
  return compiled;
}

// returnType — как <returnType> в xdb: 'float' | 'int' | 'bool'
export function runFormula(src, ctx, returnType = 'float') {
  const { ast, error } = compileFormula(src);
  if (!ast) {
    ctx.unknown?.add(`синтаксис: ${error}`);
    return returnType === 'bool' ? false : 0;
  }
  const value = evaluate(ast, ctx);
  if (returnType === 'bool') return truthy(value);
  if (returnType === 'int') return toInt(num(value));
  return Math.fround(num(value));
}

// Масштаб способности (PFAbilityData::GetAbilityScale) по параметрам AILogic.AILP
export function abilityScale(params, isDamage, mode, stat, left, right, round = true) {
  const kind = ['Stat', 'Life', 'Energy'][mode] || 'Stat';
  const prefix = isDamage ? 'damageScale' : 'abilityScale';
  const statLeft = Number(params?.[`${prefix}${kind}Left`] ?? 50);
  const statRight = Number(params?.[`${prefix}${kind}Right`] ?? 160);
  let result = Math.max(((stat - statLeft) * (right - left)) / (statRight - statLeft) + left, left);
  if (round) result = Math.round(result);
  return result;
}
