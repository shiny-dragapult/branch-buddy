import * as assert from 'assert';
import { Config } from '../../src/config/Config';

suite('Config (integration coverage)', () => {
    test('make() applies defaults and trims optional strings', () => {
        const cfg = Config.make({
            group: '  coverage-group  ',
            groupColor: '  #abcdef  ',
        });

        assert.strictEqual(cfg.group, 'coverage-group');
        assert.strictEqual(cfg.color, '#c41e3a');
        assert.strictEqual(cfg.foreground, '#ffffff');
        assert.strictEqual(cfg.groupColor, '#abcdef');
        assert.strictEqual(cfg.heartbeatMs, 5000);
        assert.strictEqual(cfg.staleMs, 30000);
    });

    test('make() preserves explicitly supplied values', () => {
        const cfg = Config.make({
            color: '#112233',
            foreground: '#445566',
            heartbeatMs: 123,
            staleMs: 456,
        });

        assert.strictEqual(cfg.color, '#112233');
        assert.strictEqual(cfg.foreground, '#445566');
        assert.strictEqual(cfg.groupColor, undefined);
        assert.strictEqual(cfg.heartbeatMs, 123);
        assert.strictEqual(cfg.staleMs, 456);
    });
});
