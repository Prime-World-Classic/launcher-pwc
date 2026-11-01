// Какие MAC-адреса годятся, чтобы узнать ПК (привязка твинков в игре —
// pw-api objects/accountLink.js, и отпечаток для сайта статистики — stats.js).
//
// MAC — адрес сетевой карты, а не ПК. Годится только встроенная карта:
// Ethernet или Wi-Fi на шине PCI. Не годятся — и раньше склеивали разных
// игроков — адаптеры, которые переходят между ПК или одинаковы у многих:
//  - VPN и туннели (Radmin VPN, ZeroTier, Hamachi, OpenVPN TAP, WireGuard/
//    Wintun, Tailscale, коммерческие VPN-клиенты);
//  - виртуальные (Hyper-V/WSL vEthernet, VMware, VirtualBox, Docker, Npcap
//    loopback, Wi-Fi Direct, мост);
//  - USB-сетевые карты и модемы, раздача с телефона (RNDIS), Bluetooth;
//  - локально назначенные адреса (второй бит первого байта: случайные MAC
//    Wi-Fi, большинство виртуальных).
//
// Тип карты Windows знает (Win32_NetworkAdapter: PhysicalAdapter,
// PNPDeviceID «PCI\…»/«USB\…»/«ROOT\…», описание) — его читаем один раз за
// запуск PowerShell'ом. Пока ответа нет (или не Windows) — фильтр по имени
// интерфейса и по самому адресу. Если строгий фильтр не оставил ничего,
// берём следующий по мягкости: поиск боя без MAC сервер не пускает.

export class NetAdapters {
  static TIMEOUT_MS = 6000;

  /** Windows: Map mac → {pnp, physical, name}; null — ещё не прочитано / не Windows. */
  static adapters = null;

  static loading = null;

  // Имена и описания VPN, туннелей, виртуальных, USB и мобильных адаптеров.
  static SKIP =
    /vpn|radmin|zerotier|hamachi|logmein|openvpn|tap-windows|\btap\d*\b|tap0901|wintun|wireguard|\btun\d*\b|tunnel|tailscale|nordlynx|nord|proton|mullvad|windscribe|surfshark|softether|fortinet|forticlient|anyconnect|cisco|globalprotect|pangp|pulse secure|sonicwall|check ?point|kaspersky|adguard|outline|psiphon|hotspot shield|cloudflare warp|warp|virtual|hyper-v|vethernet|vmware|vmnet|virtualbox|vbox|host-only|parallels|qemu|kvm|docker|wsl|loopback|npcap|km-test|bluetooth|personal area network|wi-?fi direct|wan miniport|remote ndis|rndis|usb|mobile|android|iphone|apple mobile|modem|teredo|isatap|6to4|\bppp\b|bridge|multiplexor/i;

  /** 'AA-BB-CC-DD-EE-FF' / 'aa:bb:…' → 'aa:bb:cc:dd:ee:ff'; негодный → ''. */
  static normalize(mac) {
    const hex = `${mac || ''}`.toLowerCase().replace(/[^0-9a-f]/g, '');
    if (hex.length !== 12 || /^0+$/.test(hex) || /^f+$/.test(hex)) return '';
    return hex.match(/../g).join(':');
  }

  /** Адрес сам по себе не годится: multicast, локально назначенный, OUI виртуальных, TAP. */
  static badAddress(mac) {
    const first = parseInt(mac.slice(0, 2), 16);
    if (first & 1 || first & 2) return true;
    if (mac.startsWith('00:ff:')) return true;
    return ['00:05:69', '00:0c:29', '00:1c:14', '00:50:56', '08:00:27', '00:15:5d', '00:03:ff', '00:16:3e', '00:1c:42', '52:54:00'].includes(mac.slice(0, 8));
  }

  /**
   * Годные MAC из os.networkInterfaces(), от строгого фильтра к мягкому.
   * adapters — Map mac → {pnp, physical, name} от Windows или null.
   *
   * @param {Record<string, Array<{mac?:string, internal?:boolean}>>} interfaces
   * @param {Map<string, {pnp:string, physical:boolean, name:string}>|null} adapters
   * @returns {string[]} адреса в виде 'aa:bb:cc:dd:ee:ff'
   */
  static pick(interfaces, adapters = null) {
    const seen = new Map(); // mac → имя интерфейса
    for (const [name, list] of Object.entries(interfaces || {})) {
      for (const ni of list || []) {
        if (!ni || ni.internal) continue;
        const mac = NetAdapters.normalize(ni.mac);
        if (mac && !seen.has(mac)) seen.set(mac, `${name}`);
      }
    }
    const all = [...seen.keys()];
    const named = all.filter((mac) => !NetAdapters.SKIP.test(seen.get(mac)));
    const clean = named.filter((mac) => !NetAdapters.badAddress(mac));

    let strict = clean;
    if (adapters && adapters.size) {
      strict = clean.filter((mac) => {
        const info = adapters.get(mac);
        return Boolean(info && info.physical && /^PCI\\/i.test(info.pnp) && !NetAdapters.SKIP.test(info.name));
      });
    }

    for (const list of [strict, clean, named, all]) {
      if (list.length) return list;
    }
    return [];
  }

  /** Разбор ответа PowerShell: [{m, p, f, n}] → Map mac → {pnp, physical, name}. */
  static parse(stdout) {
    const result = new Map();
    let rows;
    try {
      rows = JSON.parse(`${stdout || ''}`.trim() || '[]');
    } catch {
      return result;
    }
    for (const row of Array.isArray(rows) ? rows : [rows]) {
      const mac = NetAdapters.normalize(row && row.m);
      if (!mac) continue;
      result.set(mac, { pnp: `${row.p || ''}`, physical: row.f === true, name: `${row.n || ''}` });
    }
    return result;
  }

  /** Прочитать сетевые карты Windows (один раз за запуск, не дольше TIMEOUT_MS). */
  static load(childProcess, platform) {
    if (NetAdapters.loading) return NetAdapters.loading;
    NetAdapters.loading = new Promise((resolve) => {
      if (platform !== 'win32' || !childProcess) return resolve(null);
      const script =
        "$ErrorActionPreference='SilentlyContinue'; " +
        '@(Get-CimInstance Win32_NetworkAdapter | Where-Object { $_.MACAddress } | ForEach-Object { ' +
        "[pscustomobject]@{ m=$_.MACAddress; p=[string]$_.PNPDeviceID; f=[bool]$_.PhysicalAdapter; n=(@($_.Name,$_.Description,$_.ServiceName,$_.NetConnectionID) -join ' ') } " +
        '}) | ConvertTo-Json -Compress';
      try {
        childProcess.execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
          { timeout: NetAdapters.TIMEOUT_MS, windowsHide: true },
          (error, stdout) => {
            if (!error) NetAdapters.adapters = NetAdapters.parse(stdout);
            resolve(NetAdapters.adapters);
          },
        );
      } catch {
        resolve(null);
      }
    });
    return NetAdapters.loading;
  }
}
