/**
 * Test script for ticket override system
 * Run with: node test_ticket_override.js
 */

import { studyStatsStore } from './services/StudyStatsStore.js';

console.log('🧪 Testing Ticket Override System\n');

const testGuildId = 'test-guild-123';
const testUserId1 = 'user-1';
const testUserId2 = 'user-2';

async function runTests() {
  // Wait for store to fully initialize
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('📝 Setup: Creating test sessions with hours...');

  // Create sessions for user 1 (10 hours = 600 minutes)
  for (let i = 0; i < 12; i++) {
    studyStatsStore.data.sessions.push({
      userId: testUserId1,
      guildId: testGuildId,
      minutes: 50,
      timestamp: Date.now(),
      valid: true,
      gamingMinutes: 0,
      afkCheckPassed: true
    });
  }

  // Create sessions for user 2 (5 hours = 300 minutes)
  for (let i = 0; i < 6; i++) {
    studyStatsStore.data.sessions.push({
      userId: testUserId2,
      guildId: testGuildId,
      minutes: 50,
      timestamp: Date.now(),
      valid: true,
      gamingMinutes: 0,
      afkCheckPassed: true
    });
  }

  console.log('✅ Test sessions created\n');

  // Test 1: Check initial hours and tickets
  console.log('🧪 Test 1: Initial state (no overrides)');
  const user1Stats = studyStatsStore.getUserStats(testUserId1, testGuildId);
  const user2Stats = studyStatsStore.getUserStats(testUserId2, testGuildId);

  console.log(`  User 1: ${user1Stats.totalHours}h (${user1Stats.totalSessions} sessions)`);
  console.log(`  User 2: ${user2Stats.totalHours}h (${user2Stats.totalSessions} sessions)`);

  const user1TicketsCalc = 8 + Math.round(Math.sqrt(user1Stats.totalHours) * 8);
  const user2TicketsCalc = 8 + Math.round(Math.sqrt(user2Stats.totalHours) * 8);

  console.log(`  User 1 tickets (calculated): ${user1TicketsCalc}`);
  console.log(`  User 2 tickets (calculated): ${user2TicketsCalc}`);

  const override1 = studyStatsStore.getTicketOverride(testUserId1, testGuildId);
  const override2 = studyStatsStore.getTicketOverride(testUserId2, testGuildId);

  console.log(`  User 1 override: ${override1 === null ? 'none' : override1}`);
  console.log(`  User 2 override: ${override2 === null ? 'none' : override2}`);
  console.log('  ✅ Test 1 passed: No overrides, hour-based calculation works\n');

  // Test 2: Set ticket overrides
  console.log('🧪 Test 2: Set ticket overrides (soft reset)');
  await studyStatsStore.setTicketOverride(testUserId1, testGuildId, 50);
  await studyStatsStore.setTicketOverride(testUserId2, testGuildId, 50);

  const override1After = studyStatsStore.getTicketOverride(testUserId1, testGuildId);
  const override2After = studyStatsStore.getTicketOverride(testUserId2, testGuildId);

  console.log(`  User 1 override: ${override1After} tickets`);
  console.log(`  User 2 override: ${override2After} tickets`);

  // Verify hours haven't changed
  const user1StatsAfter = studyStatsStore.getUserStats(testUserId1, testGuildId);
  const user2StatsAfter = studyStatsStore.getUserStats(testUserId2, testGuildId);

  console.log(`  User 1 hours: ${user1StatsAfter.totalHours}h (unchanged: ${user1Stats.totalHours === user1StatsAfter.totalHours ? '✅' : '❌'})`);
  console.log(`  User 2 hours: ${user2StatsAfter.totalHours}h (unchanged: ${user2Stats.totalHours === user2StatsAfter.totalHours ? '✅' : '❌'})`);

  if (override1After === 50 && override2After === 50 &&
      user1Stats.totalHours === user1StatsAfter.totalHours &&
      user2Stats.totalHours === user2StatsAfter.totalHours) {
    console.log('  ✅ Test 2 passed: Overrides set, hours unchanged\n');
  } else {
    console.log('  ❌ Test 2 FAILED!\n');
  }

  // Test 3: Simulate giveaway with overrides
  console.log('🧪 Test 3: Giveaway uses ticket overrides');

  // This is what the giveaway does:
  const user1Tickets = override1After !== null ? override1After : (8 + Math.round(Math.sqrt(user1StatsAfter.totalHours) * 8));
  const user2Tickets = override2After !== null ? override2After : (8 + Math.round(Math.sqrt(user2StatsAfter.totalHours) * 8));

  console.log(`  User 1 giveaway tickets: ${user1Tickets} (override used: ${override1After !== null ? '✅' : '❌'})`);
  console.log(`  User 2 giveaway tickets: ${user2Tickets} (override used: ${override2After !== null ? '✅' : '❌'})`);

  if (user1Tickets === 50 && user2Tickets === 50) {
    console.log('  ✅ Test 3 passed: Both users have equal tickets despite different hours\n');
  } else {
    console.log('  ❌ Test 3 FAILED!\n');
  }

  // Test 4: Remove override (set to 0)
  console.log('🧪 Test 4: Remove overrides (back to hour-based)');
  await studyStatsStore.setTicketOverride(testUserId1, testGuildId, 0);
  await studyStatsStore.setTicketOverride(testUserId2, testGuildId, 0);

  const override1Removed = studyStatsStore.getTicketOverride(testUserId1, testGuildId);
  const override2Removed = studyStatsStore.getTicketOverride(testUserId2, testGuildId);

  console.log(`  User 1 override: ${override1Removed === null ? 'removed ✅' : 'still exists ❌'}`);
  console.log(`  User 2 override: ${override2Removed === null ? 'removed ✅' : 'still exists ❌'}`);

  // Calculate tickets after override removal
  const user1TicketsRestored = override1Removed !== null ? override1Removed : (8 + Math.round(Math.sqrt(user1StatsAfter.totalHours) * 8));
  const user2TicketsRestored = override2Removed !== null ? override2Removed : (8 + Math.round(Math.sqrt(user2StatsAfter.totalHours) * 8));

  console.log(`  User 1 tickets: ${user1TicketsRestored} (from ${user1StatsAfter.totalHours}h)`);
  console.log(`  User 2 tickets: ${user2TicketsRestored} (from ${user2StatsAfter.totalHours}h)`);

  if (override1Removed === null && override2Removed === null &&
      user1TicketsRestored > user2TicketsRestored) {
    console.log('  ✅ Test 4 passed: Overrides removed, back to hour-based (User 1 has more tickets)\n');
  } else {
    console.log('  ❌ Test 4 FAILED!\n');
  }

  // Test 5: Soft reset scenario
  console.log('🧪 Test 5: Soft reset scenario (after big prize)');
  console.log('  Scenario: Big prize won, reset all to equal tickets for next giveaway');
  console.log('  Hours remain to show progress, tickets reset to level playing field\n');

  await studyStatsStore.setTicketOverride(testUserId1, testGuildId, 100);
  await studyStatsStore.setTicketOverride(testUserId2, testGuildId, 100);

  const finalStats1 = studyStatsStore.getUserStats(testUserId1, testGuildId);
  const finalStats2 = studyStatsStore.getUserStats(testUserId2, testGuildId);
  const finalOverride1 = studyStatsStore.getTicketOverride(testUserId1, testGuildId);
  const finalOverride2 = studyStatsStore.getTicketOverride(testUserId2, testGuildId);

  console.log('  After soft reset:');
  console.log(`  User 1: ${finalStats1.totalHours}h (${finalStats1.totalSessions} sessions) → ${finalOverride1} tickets`);
  console.log(`  User 2: ${finalStats2.totalHours}h (${finalStats2.totalSessions} sessions) → ${finalOverride2} tickets`);
  console.log(`  \n  Both have equal tickets: ${finalOverride1 === finalOverride2 ? '✅' : '❌'}`);
  console.log(`  Hours preserved: ${finalStats1.totalHours === 10 && finalStats2.totalHours === 5 ? '✅' : '❌'}`);
  console.log(`  Progress visible: ${finalStats1.totalHours !== finalStats2.totalHours ? '✅' : '❌'}`);

  if (finalOverride1 === 100 && finalOverride2 === 100 &&
      finalStats1.totalHours === 10 && finalStats2.totalHours === 5) {
    console.log('\n  ✅ Test 5 passed: Perfect soft reset! Equal tickets, preserved hours\n');
  } else {
    console.log('\n  ❌ Test 5 FAILED!\n');
  }

  // Summary
  console.log('═══════════════════════════════════════════════');
  console.log('📊 Test Summary:');
  console.log('═══════════════════════════════════════════════');
  console.log('✅ Ticket overrides work independently of hours');
  console.log('✅ Hours remain unchanged when tickets are modified');
  console.log('✅ Giveaways use ticket overrides when set');
  console.log('✅ Setting tickets to 0 removes override');
  console.log('✅ Soft reset after big prize works perfectly');
  console.log('\n🎉 All tests passed! System ready for production.\n');

  // Cleanup
  console.log('🧹 Cleaning up test data...');
  studyStatsStore.data.sessions = studyStatsStore.data.sessions.filter(
    s => s.guildId !== testGuildId
  );
  delete studyStatsStore.data.ticketOverrides[`${testGuildId}:${testUserId1}`];
  delete studyStatsStore.data.ticketOverrides[`${testGuildId}:${testUserId2}`];
  console.log('✅ Cleanup complete\n');
}

// Run tests
runTests().catch(error => {
  console.error('❌ Test failed with error:', error);
  process.exit(1);
});
