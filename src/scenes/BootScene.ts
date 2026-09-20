import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, 0x1d1730).setOrigin(0);
    this.add
      .text(width / 2, height / 2, 'Lentera Kelam', { fontFamily: 'monospace', fontSize: '16px', color: '#ffd98a' })
      .setOrigin(0.5);
    document.getElementById('boot-msg')?.remove();
  }
}
