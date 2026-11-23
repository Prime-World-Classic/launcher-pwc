// Копия pw-api objects/nicknameFilter.js (фильтр ников). Не править здесь: правка — в pw-api,
// потом node tools/chat-filter/sync_nickname_filter.mjs. Использует мат-фильтр чата (chatFilter.js).
// Фильтр ников: мат, оскорбления, нацистская тема.
//
// Ник разрешён только русскими или только латинскими буквами (Nickname.check
// в user.model.js), поэтому обходы бывают такие, и все они проверяются:
//   * пробелы внутри слова: «Сосуч Лен», «П и з д а» — слова склеиваются;
//   * цифры вместо букв: «Г1тлер», «4лен», «Сук4», «6ля»;
//   * латиница, похожая на кириллицу: «Cyka», «XYILO»;
//   * транслит: «pidor», «huy», «gitler», «zalupa»;
//   * не та раскладка: «cerf» = «сука», «ubnkth» = «гитлер», «ршедук» = «hitler»;
//   * повтор букв: «суууука».
// Для каждого варианта написания слово ищется по корням (CYR — русские,
// LAT — английские). SAFE_* — обычные слова, внутри которых корень
// встречается случайно («барсук», «спидран», «Asuka»): совпадение,
// начавшееся внутри такого слова, не считается.
//
// Используется при регистрации, смене ника, входе через Steam/Яндекс и в
// tools/nickname_sweep.js (проход по базе: banNickname → в игре и чате [idN]).
// Проверка — node tools/nickname_filter_smoke.js.

// layoutWhole — корень короткий и в чужой раскладке совпадает с обычными
// английскими словами («cerberus» → «сукиукгы»): по раскладке такой корень
// считается, только если ник почти целиком из него и состоит («cerf»).
const CYR = [
	{re:/ху[йиеяю]/g, word:'ху*'},
	{re:/п[ие][зс]д|пизж/g, word:'пизд*'},
	{re:/^бля(?![хш])|бляд|блят|выбляд|ублюд/g, word:'бля*'},
	// Перед «еб» не берём согласные обычных слов и английских сочетаний:
	// волшебный, хлеб, Глеба, стебать, Magebane, BaneBlade, Whitebat, dakebarber.
	{re:/(?<![шчдлжрхгтк])еб(а[лнтшркц]|ну|у[чн]|ы[рл]|ись|ец|ищ|ош|лан|ло(?![вк])|лищ)/g, word:'еб*'},
	// ебёт, ебут, ебни, ебля — и после «н» не берём: Небет, Ребут, хлебни, гребля.
	{re:/(?<![шчдлжрхгткнвм])еб(ет|ут|ни|ит[еь]|л[яи]|лей)/g, word:'еб*'},
	// Приставки: выебон, наебка, подъебка, доебал, недоеб, мудоеб.
	{re:/(вы|въ|съ|подъ|отъ|разъ|на|до|за|мудо)еб(?=[аеиоуыяюлнкщ]|$)/g, word:'еб*'},
	{re:/йоб[аниу]/g, word:'еб*'},
	{re:/уеб[аиоыу]/g, word:'уеб*'},
	// «п» вместо «б»: епаный, ёпта, заепал, йопта. Только с начала слова: Непал, репа, цепан.
	{re:/^(вы|на|за|до|от|по|у)?[её]п(ан|ат|ал|ну|т[аиь]?$|ти[тш])|^йоп(т|ан|ат)/g, word:'еб*'},
	{re:/д[ао]лб[ао]е?б/g, word:'долбоеб'},
	{re:/муд[аои][кл]|мудач|мудозв/g, word:'мудак'},
	{re:/пид[оаеи]р|пидр|педрил|педик|педераст|педоф/g, word:'пидор'},
	{re:/залуп/g, word:'залупа'},
	{re:/г[ао]нд[ао]н/g, word:'гандон'},
	{re:/шлюх|шлюш|шалав|проститут/g, word:'шлюха'},
	{re:/сук[аиуо]|сучк|сучар|сучь|сучий|сучен|сучон/g, word:'сука', layoutWhole:true},
	{re:/член/g, word:'член'},
	{re:/сос[иу](?![лдсщк])|сосат|сосал|соснул|соснут|сосни|отсос|сосун/g, word:'сосать'},
	{re:/дроч/g, word:'дроч*'},
	{re:/минет/g, word:'минет'},
	{re:/жоп/g, word:'жопа'},
	{re:/г[ао]вн/g, word:'говно'},
	{re:/дерьм/g, word:'дерьмо'},
	// срёт, срут, срёшь; не Сретение.
	{re:/сра[нлтк]|срешь|срет$|срут/g, word:'срать', layout:false},
	{re:/^(на|по)хер/g, word:'нахер'},
	{re:/спермо[её]д|сперматрах/g, word:'сперма'},
	{re:/сиськ|сисек|сисяр/g, word:'сиськи'},
	{re:/пенис|вагин|влагалищ/g, word:'пенис'},
	{re:/трах(н|а[еилтюя]|ен)/g, word:'трахать'},
	{re:/порн|секс/g, word:'порно'},
	{re:/мраз[ьи]/g, word:'мразь'},
	{re:/ниггер|нигга|нигер(?!и)/g, word:'ниггер'},
	{re:/[гх]итлер|адольф|фюрер|хайль|хейль|зигх?[ае][йи]л|зигова|зигу[юе]/g, word:'Гитлер'},
	{re:/нацис|нацизм|неонац|фашис|фашизм|свастик/g, word:'нацизм'},
	{re:/гиммлер|геб+ельс|гестап|освенцим|аушвиц|холокост|вермахт|третийрейх|рейхсф|ваффенсс|бухенвальд|менгеле|гейдрих|[эа]йхман|нсдап|тысячелетнийрейх/g, word:'нацизм'}
];

// layout:false — по раскладке ru→en не проверять: русские ники в латинской
// раскладке дают «fck»/«fuk» сами по себе (Расл → hfck, Нагловат → yfukjdfn).
// «ршедук» → hitler при этом ловится.
const LAT = [
	{re:/fuck|fck|phuck|motherf/g, word:'fuck', layout:false},
	{re:/shit(?![aeo])/g, word:'shit', layout:false},
	{re:/bitch|biatch|beeyotch|whor|cunt|slut(?!sk)|faggot|a(ss|rse)hole|analsex|penis|vagina|porn/g, word:'bitch', layout:false},
	// Английские ругательства и сексуальное; «rapist» — не в Therapist.
	{re:/(blow|hand|rim|wank)job|deepthroat|cum(shot|slut|dump|guzzl)|cock(suck|head|face|womble)|dick(head|face|wad|weed|bag)|pussy(lick|slay|fuck)|titfuck|wank(er|ing|stain)|twat|tosser|bellend|knobhead|douche(bag|canoe|face)|(jack|dumb|smart)ass|piss(off|edoff|face|head)|(?<!the)rapist/g, word:'insult', layout:false},
	{re:/nigger|nigga|niger(?!i)/g, word:'nigger', layout:false},
	{re:/hitler|adolf|f(u|ue|yu|iu)h?rer|(sieg|zig|sig)h?(eil|ail)/g, word:'Hitler'},
	{re:/nazis|nazism|neonazi|swastik|svastik|himmler|go?e?b+els|gestapo|auschwitz|holocaust|wehrmacht|thirdreich|drittesreich|reichsf|waffenss|mengele|heydrich|eichmann|nsdap|hitlerjugend/g, word:'nazism'}
];

// Фразы и полные имена: слова длинные и по отдельности не склеиваются
// («Мартин Борман», «третий рейх»), поэтому ищутся по всему нику с любыми
// разделителями между словами.
const PHRASES = [
	{re:/(ева|эва)(анна)?(паула)?браун|eva(anna)?(paula)?braun/, word:'нацизм'},
	{re:/мартинборман|martinborman|германг[её]ринг|hermanng(o|oe)ring|hermangoring|рудольф[гх]есс|rudolfhes|reinhardt?heydrich|adolph?eichmann/, word:'нацизм'},
	{re:/белаявласть|whitepower|кровьичесть|bloodandhonou?r|третийрейх|thirdreich|drittesreich|националсоциалист|nationalsocialist|hitleryouth/, word:'нацизм'}
];

const SAFE_CYR = ['барсук','асук','суккуб','сукуб','сукун','сукум','страху','спидр','спидер','педикюр','сосиск','дебат','ебург','антифаш','смертьфаш','эссекс','эсекс','мидлсекс','пенист','нигери','спорн','ссср','сраками','сухую','леговн','ноебал','яшалав','епатаж','епанч'];;

const SAFE_LAT = ['fukus','ashita','shitak','scunthorpe','essex','nigeri','sporn'];

// Куски обычных латинских ников, которые после перевода в кириллицу или
// раскладку дают корень: Cerber/Ceres (по раскладке «суки», «суку»),
// ErgoProxy («ргоху»), ЗРЕНИЕ латиницей («пехуе»), Трусики латиницей
// («тпйсуку»), Coca/Cocos («сосал», «отсос»), SSSRat, «Смерть фашистам».
// Заменяются разрывом до всех проверок, без учёта регистра.
const SAFE_RAW = ['cerb','cere','proxy','3pehue','xpehue','tpycuk','coca','cocos','sssr','ykysu','смертьфаш','смерть фаш','сосисоч','сосиск'];

const SAFE_RAW_RE = new RegExp(SAFE_RAW.join('|'),'giu');

// Латиница, похожая на кириллицу: «Cyka», «XYILO», «6ЛЯ» уже цифрами.
// n → п не берём: Nezdeshniy читался как «пездешпий».
const LOOKALIKE = {a:'а',b:'в',c:'с',d:'д',e:'е',f:'ф',g:'д',h:'н',i:'и',j:'й',k:'к',l:'л',m:'м',o:'о',p:'р',q:'д',r:'г',t:'т',u:'и',v:'в',w:'ш',x:'х',y:'у',z:'з'};
// Транслит: сначала сочетания, потом одиночные буквы. c — «к» (Aristocrat,
// Cracken, unsocial), «С» латиницей ловит LOOKALIKE. th/gh — английские
// сочетания (Cthulhu, ngonhathuy).
const TRANSLIT_PAIRS = [['shch','щ'],['sch','щ'],['sh','ш'],['ch','ч'],['zh','ж'],['kh','х'],['th','т'],['gh','г'],['ts','ц'],['tz','ц'],['ya','я'],['ja','я'],['yu','ю'],['ju','ю'],['yo','е'],['jo','е'],['ye','е'],['je','е'],['ck','к'],['ph','ф']];

const TRANSLIT = {a:'а',b:'б',c:'к',d:'д',e:'е',f:'ф',g:'г',h:'х',i:'и',j:'й',k:'к',l:'л',m:'м',n:'н',o:'о',p:'п',q:'к',r:'р',s:'с',t:'т',u:'у',v:'в',w:'в',x:'х',y:'й',z:'з'};

const CONSONANTS = 'bcdfgjklmnpqrstvwxz';

// Раскладка ЙЦУКЕН: латинская клавиша → русская буква на ней. Буквы на
// клавишах со скобками и знаками (х ъ ж э б ю) латиницей не набрать.
const LAYOUT_EN_RU = {q:'й',w:'ц',e:'у',r:'к',t:'е',y:'н',u:'г',i:'ш',o:'щ',p:'з',a:'ф',s:'ы',d:'в',f:'а',g:'п',h:'р',j:'о',k:'л',l:'д',z:'я',x:'ч',c:'с',v:'м',b:'и',n:'т',m:'ь'};

const LAYOUT_RU_EN = Object.fromEntries(Object.entries(LAYOUT_EN_RU).map(([en,ru]) => [ru,en]));

// Цифры вместо букв: два прочтения («4лен» — ч, «сук4» — а) и без цифр.
// Три цифры подряд и больше — число (год, номер), не буквы: Leokun1996 не
// «leokunigg», Александр2004 не «александроч».
const DIGITS_CYR = [
	{0:'о',1:'и',3:'з',4:'ч',6:'б',8:'в'},
	{0:'о',1:'л',3:'е',4:'а',6:'б',9:'я'}
];

const DIGITS_LAT = [
	{0:'o',1:'i',3:'e',4:'a',5:'s',6:'b',7:'t',8:'b'}
];

function mapChars(text,table){

	let out = '';

	for(const ch of text){

		out += (ch in table) ? table[ch] : ch;

	}

	return out;

}

function translit(text){

	let out = '';

	for(let i = 0; i < text.length;){

		const pair = TRANSLIT_PAIRS.find(([from]) => text.startsWith(from,i));

		if(pair){

			out += pair[1];

			i += pair[0].length;

			continue;

		}

		const ch = text[i];

		// h после согласной не читается (Silhouette, fhuec): иначе «хуе».
		if( (ch == 'h') && (i > 0) && CONSONANTS.includes(text[i - 1]) ){

			i++;

			continue;

		}

		out += (ch in TRANSLIT) ? TRANSLIT[ch] : ch;

		i++;

	}

	return out;

}

// Варианты с цифрами: как буквы (по каждой таблице) и без цифр.
function withDigits(text,tables){

	if(!/\d/.test(text)){

		return [text];

	}

	return [text.replace(/\d/g,''),...tables.map((table) => mapChars(text,table))];

}

class NicknameFilter {

	// Все варианты написания ника: {cyr:[{text,layout}], lat:[{text,layout}]}.
	static forms(name){

		// Совместимые формы (ＦＵＣＫ → FUCK) и невидимые символы. В новый ник они
		// не пройдут проверку символов, но в базе бывают старые ники.
		const source = String(name ?? '').normalize('NFKC').replace(/\p{Cf}/gu,'');

		const raw = source.toLowerCase().replace(/ё/g,'е');

		// Слова в CamelCase разделяются: FranzHopper — не «франжоппер».
		const clean = source
			.replace(SAFE_RAW_RE,' ')
			// Хвост, который бэкенд дописывает к занятому нику (SteamId 70eb5c,
			// BioMan 6d03b9): случайный hex, по нему ничего не ищем.
			.replace(/(?<![0-9a-z])(?=[0-9a-f]*\d)[0-9a-f]{6}(?![0-9a-z])/giu,' ')
			.replace(/([a-zа-яё])([A-ZА-ЯЁ])/gu,'$1 $2')
			.toLowerCase()
			.replace(/ё/g,'е')
			.replace(/\d{3,}/g,' ');

		const words = clean.split(/[^a-zа-я0-9]+/u).filter(Boolean);

		// Склейка ловит «Сосуч Лен» и «П и з д а»: слово склеивается с
		// соседом, если хотя бы одно из двух короткое (до 4 знаков). Два
		// длинных слова не склеиваются: «Смещение баланса» — не «ебал».
		// Отдельные слова — для корней с ^ («Бля Вася»).
		const pieces = [];

		let segment = '';

		for(let i = 0; i < words.length; i++){

			if( (i > 0) && (words[i - 1].length > 4) && (words[i].length > 4) ){

				pieces.push(segment);

				segment = '';

			}

			segment += words[i];

		}

		if(segment){

			pieces.push(segment);

		}

		if(words.length > 1){

			pieces.push(...words);

		}

		const cyr = [], lat = [];

		for(const piece of pieces){

			if(/[а-я]/.test(piece) || !/[a-z]/.test(piece)){

				for(const text of withDigits(piece,DIGITS_CYR)){

					cyr.push({text,layout:false});

				}

				lat.push({text:mapChars(piece.replace(/\d/g,''),LAYOUT_RU_EN),layout:true});

			}

			if(/[a-z]/.test(piece)){

				for(const text of withDigits(piece,DIGITS_LAT)){

					lat.push({text,layout:false});

				}

				for(const text of withDigits(mapChars(piece,LOOKALIKE),DIGITS_CYR)){

					cyr.push({text,layout:false});

				}

				for(const text of withDigits(translit(piece),DIGITS_CYR)){

					cyr.push({text,layout:false});

				}

				cyr.push({text:mapChars(piece.replace(/\d/g,''),LAYOUT_EN_RU),layout:true});

			}

		}

		// Буква, которую не перевели (латиница в русском варианте и наоборот),
		// становится разрывом «#», а не выпадает: иначе соседние буквы
		// склеятся в слово, которого в нике нет. Цифры уже разобраны выше.
		const finish = (list,foreign) => {

			const seen = new Set(), out = [];

			for(const item of list){

				const text = item.text.replace(foreign,'#').replace(/\d/g,'');

				for(const variant of [text,text.replace(/(.)\1+/g,'$1')]){

					const key = `${item.layout ? 1 : 0}:${variant}`;

					if( (variant.length > 1) && !seen.has(key) ){

						seen.add(key);

						out.push({text:variant,layout:item.layout});

					}

				}

			}

			return out;

		};

		return {
			raw,
			// Весь ник одной строкой: только буквы, для PHRASES.
			joined:raw.replace(/[^a-zа-я]/g,''),
			cyr:finish(cyr,/[a-z]/g),
			lat:finish(lat,/[а-я]/g)
		};

	}

	static scan(form,patterns,safe){

		for(const pattern of patterns){

			pattern.re.lastIndex = 0;

			for(const match of form.text.matchAll(pattern.re)){

				const start = match.index;

				if(safe.some((word) => {

					for(let i = form.text.indexOf(word); i != -1; i = form.text.indexOf(word,i + 1)){

						if( (start >= i) && (start < i + word.length) ){

							return true;

						}

					}

					return false;

				})){

					continue;

				}

				if( form.layout && (pattern.layout === false) ){

					break;

				}

				if( form.layout && pattern.layoutWhole && (form.text.length > match[0].length + 2) ){

					continue;

				}

				return {word:pattern.word,match:match[0],form:form.text};

			}

		}

		return null;

	}

	// null — ник чистый, иначе {word, match, form}: что нашлось и в каком
	// варианте написания (для отчёта tools/nickname_sweep.js).
	static check(name){

		const forms = NicknameFilter.forms(name);

		// 1488/8814 — отдельным числом или в конце числа (Timon1488, 2281488),
		// и 14…88 вокруг ника (14Martin88, 14/88). Не Player14880 и не 1988.
		const digits = forms.raw.match(/(?<!\d)(\d*1488|8814)(?!\d)|(?<!\d)14\D{0,16}88(?!\d)/);

		if(digits){

			return {word:'1488',match:digits[0],form:forms.raw};

		}

		for(const phrase of PHRASES){

			const match = forms.joined.match(phrase.re);

			if(match){

				return {word:phrase.word,match:match[0],form:forms.joined};

			}

		}

		for(const form of forms.cyr){

			const found = NicknameFilter.scan(form,CYR,SAFE_CYR);

			if(found){

				return found;

			}

		}

		for(const form of forms.lat){

			const found = NicknameFilter.scan(form,LAT,SAFE_LAT);

			if(found){

				return found;

			}

		}

		return null;

	}

	static bad(name){

		return NicknameFilter.check(name) !== null;

	}

}

export { NicknameFilter, CYR, LAT, PHRASES, SAFE_CYR, SAFE_LAT };
