class SpatialAudio {
    constructor() {
        this.gainNodes = new Map();  // socketId -> GainNode
        this.audioContext = null;
        this.myRobloxUsername = null;
    }

    init(robloxUsername) {
        this.myRobloxUsername = robloxUsername;
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    createGainForPeer(socketId, audioElement) {
        if (!this.audioContext) return audioElement;

        const source = this.audioContext.createMediaElementSource(audioElement);
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = 1.0;

        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        this.gainNodes.set(socketId, { gainNode, audioElement });
        return audioElement;
    }

    removePeer(socketId) {
        const entry = this.gainNodes.get(socketId);
        if (entry) {
            try {
                entry.gainNode.disconnect();
            } catch { }
            this.gainNodes.delete(socketId);
        }
    }

    updateSpatialData(data, peerMap) {
        if (!this.myRobloxUsername || !data) return;

        const myData = data[this.myRobloxUsername];

        for (const [socketId, peer] of peerMap.entries()) {
            const gainEntry = this.gainNodes.get(socketId);
            if (!gainEntry) continue;

            const peerRoblox = peer.roblox_username;
            const peerData = data[peerRoblox];

            let volume = 0;

            if (myData && peerData) {
                const dx = myData.position.x - peerData.position.x;
                const dy = myData.position.y - peerData.position.y;
                const dz = myData.position.z - peerData.position.z;
                const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
                const range = peerData.range || 50;

                volume = Math.max(0, Math.min(1, 1 - (distance / range)));
            }

            gainEntry.gainNode.gain.linearRampToValueAtTime(
                volume,
                this.audioContext.currentTime + 0.1
            );
        }
    }

    destroy() {
        for (const [, entry] of this.gainNodes) {
            try { entry.gainNode.disconnect(); } catch { }
        }
        this.gainNodes.clear();
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}


window.spatialAudio = new SpatialAudio();
