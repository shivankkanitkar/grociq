import test from 'node:test';
import assert from 'node:assert/strict';
import { householdToday, monthStart, weeklyGuidance } from '../../pilot/js/budget.js';

test('household month follows its timezone, not the viewer location', () => {
  const instant = new Date('2026-11-01T01:00:00Z');
  assert.equal(householdToday('America/New_York', instant), '2026-10-31');
  assert.equal(monthStart(householdToday('America/New_York', instant)), '2026-10-01');
});

test('weekly guidance uses remaining calendar days and never disguises overspending', () => {
  assert.deepEqual(weeklyGuidance(10000, 6000, '2026-10-15'), { remaining: 4000, guidance: 1647, daysLeft: 17 });
  assert.deepEqual(weeklyGuidance(10000, 12000, '2026-10-15'), { remaining: -2000, guidance: 0, daysLeft: 0 });
  assert.equal(weeklyGuidance(null, 12000, '2026-10-15'), null);
});
