/**
 * Voice channel management for study sessions
 */

/**
 * Update voice channel name based on session phase and duration
 */
export async function updateVoiceChannelName(client, session) {
  try {
    const guild = client.guilds.cache.get(session.guildId);
    if (!guild) return;

    const vc = guild.channels.cache.get(session.voiceChannelId);
    if (!vc) return;

    let newName;
    if (session.type === "solo") {
      if (session.phase === "focus") {
        newName = `📚 Study – ${session.username} – ${session.duration}min Focus`;
      } else {
        newName = `☕ Break – ${session.username} – ${Math.round(session.duration / 5)}min`;
      }
    } else {
      if (session.phase === "focus") {
        newName = `📚 Study Group – ${session.duration}min Focus`;
      } else {
        newName = `☕ Group Break – ${Math.round(session.duration / 5)}min`;
      }
    }

    await vc.setName(newName);
    console.log(`[Study] Updated VC name to: ${newName}`);
  } catch (error) {
    console.error(`[Study] Failed to update VC name:`, error.message);
  }
}

/**
 * Mute or unmute all non-bot members in a voice channel
 * When muting: mutes current members in VC and tracks them
 * When unmuting: unmutes ALL tracked users (even if they left the VC)
 */
export async function setVoiceChannelMute(client, session, shouldMute) {
  try {
    const guild = client.guilds.cache.get(session.guildId);
    if (!guild) return;

    const vc = guild.channels.cache.get(session.voiceChannelId);
    if (!vc) return;

    if (shouldMute) {
      // Mute current members in VC
      const members = vc.members.filter(m => !m.user.bot);
      for (const [memberId, member] of members) {
        try {
          await member.voice.setMute(true);
          session.mutedUsers.add(memberId);
        } catch (error) {
          console.error(`[Study] Failed to mute member ${memberId}:`, error.message);
        }
      }
      console.log(`[Study] Muted ${members.size} members in session ${session.id}`);
    } else {
      // Unmute ALL tracked users (even if they left the VC)
      let unmutedCount = 0;
      for (const memberId of session.mutedUsers) {
        try {
          const member = await guild.members.fetch(memberId);
          if (member) {
            try {
              await member.voice.setMute(false);
              unmutedCount++;
            } catch (voiceError) {
              if (voiceError.code === 40032) {
                console.log(`[Study] User ${memberId} not in voice, skipping unmute`);
              } else {
                console.error(`[Study] Failed to unmute member ${memberId}:`, voiceError.message);
              }
            }
          }
        } catch (error) {
          console.error(`[Study] Failed to fetch member ${memberId}:`, error.message);
        }
      }
      // Clear the tracked users
      session.mutedUsers.clear();
      console.log(`[Study] Unmuted ${unmutedCount} members in session ${session.id}`);
    }
  } catch (error) {
    console.error(`[Study] Error ${shouldMute ? 'muting' : 'unmuting'} members:`, error);
  }
}
