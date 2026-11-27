'use client';

import DevicesPage from '../devices/page';

/**
 * Audio players (web 2.4.18): the Devices page scoped to playback_mode = 'audio'. Same cards,
 * schedule dialogs and batch actions; the Devices page itself now lists screens only.
 */
export default function AudioPlayersPage() {
    return <DevicesPage mode="audio" />;
}
