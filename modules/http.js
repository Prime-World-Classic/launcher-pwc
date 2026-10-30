export class HTTP {
  static async request(url, type = '') {
    let response = await fetch(url);

    switch (type) {
      case 'text':
        return await response.text();
        break;

      case 'arrayBuffer':
        return await response.arrayBuffer();
        break;

      default:
        return await response.json();
        break;
    }
  }
}
