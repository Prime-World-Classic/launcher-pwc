import { App } from './app.js';

export class DomAudio {
  static eventMouseOver() {
    //App.error("MouseOver");
    // TODO: Audio
  }
  static eventMouseDown() {
    //App.error("MouseDown");
    // TODO: Audio
  }
  static eventMouseUp(e) {
    //App.error("MouseUp");
    // TODO: Audio
  }

  static eventInput() {
    //App.error("Input");
  }

  static eventChange() {
    //App.error("Change");
  }

  eventMouseOverCallback = null;

  eventMouseDownCallback = null;

  eventMouseUpCallback = null;

  eventInputCallback = null;

  eventChangeCallback = null;

  constructor(
    mouseover = DomAudio.eventMouseOver,
    mousedown = DomAudio.eventMouseDown,
    mouseup = DomAudio.eventMouseUp,
    input = DomAudio.eventInput,
    change = DomAudio.eventChange,
  ) {
    this.eventMouseOverCallback = mouseover;

    this.eventMouseDownCallback = mousedown;

    this.eventMouseUpCallback = mouseup;

    this.eventInputCallback = input;

    this.eventChangeCallback = change;
  }
}
