// MediaPipe Hand Tracking + MIDI CC Controller
class GestureMidiController {
    constructor() {
        // Video and canvas elements
        this.videoElement = document.getElementById('videoElement');
        this.canvasElement = document.getElementById('canvasElement');
        this.canvasCtx = this.canvasElement.getContext('2d');

        // UI elements
        this.statusElement = document.getElementById('status');
        this.midiStatusElement = document.getElementById('midiStatus');
        this.distanceValueElement = document.getElementById('distanceValue');
        this.ccValueElement = document.getElementById('ccValue');
        this.scanMidiBtn = document.getElementById('scanMidiBtn');
        this.connectMidiBtn = document.getElementById('connectMidiBtn');
        this.midiDeviceSelect = document.getElementById('midiDeviceSelect');

        // Settings
        this.midiChannelInput = document.getElementById('midiChannel');
        this.ccNumberInput = document.getElementById('ccNumber');
        this.minDistanceInput = document.getElementById('minDistance');
        this.maxDistanceInput = document.getElementById('maxDistance');

        // MIDI
        this.midiAccess = null;
        this.midiOutput = null;
        this.midiOutputs = []; // Actually MIDI outputs (browser sends to DAW inputs)

        // Hand tracking state
        this.lastCCValue = -1;
        this.thumbTip = null;
        this.indexTip = null;

        // Set up event listeners IMMEDIATELY in constructor (critical for Firefox MIDI extension)
        this.scanMidiBtn.addEventListener('click', async () => {
            await this.scanMIDIDevices();
        });
        this.connectMidiBtn.addEventListener('click', async () => {
            await this.connectMIDI();
        });
        this.midiDeviceSelect.addEventListener('change', () => {
            this.onDeviceSelected();
        });

        // Initialize MediaPipe
        this.init();
    }

    async init() {
        try {
            // Initialize MediaPipe Hands
            await this.initMediaPipe();

            this.updateStatus('Ready - Show your hand to the camera', 'ready');
        } catch (error) {
            console.error('Initialization error:', error);
            this.updateStatus(`Error: ${error.message}`, 'error');
        }
    }

    async initMediaPipe() {
        // Initialize MediaPipe Hands
        this.hands = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
            }
        });

        this.hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.7
        });

        this.hands.onResults((results) => this.onResults(results));

        // Set up camera
        const camera = new Camera(this.videoElement, {
            onFrame: async () => {
                await this.hands.send({ image: this.videoElement });
            },
            width: 640,
            height: 480
        });

        camera.start();
    }

    onResults(results) {
        // Clear canvas
        this.canvasCtx.save();
        this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);

        // Draw the video frame
        this.canvasCtx.drawImage(
            results.image, 0, 0, this.canvasElement.width, this.canvasElement.height
        );

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];

            // Draw hand landmarks
            this.drawHandLandmarks(landmarks);

            // Get thumb tip (landmark 4) and index finger tip (landmark 8)
            this.thumbTip = landmarks[4];
            this.indexTip = landmarks[8];

            // Calculate distance and send MIDI
            this.processGesture();
        } else {
            this.thumbTip = null;
            this.indexTip = null;
            this.distanceValueElement.textContent = '0.00';
        }

        this.canvasCtx.restore();
    }

    drawHandLandmarks(landmarks) {
        // Draw connections
        const connections = [
            // Thumb
            [0, 1], [1, 2], [2, 3], [3, 4],
            // Index finger
            [0, 5], [5, 6], [6, 7], [7, 8],
            // Middle finger
            [0, 9], [9, 10], [10, 11], [11, 12],
            // Ring finger
            [0, 13], [13, 14], [14, 15], [15, 16],
            // Pinky
            [0, 17], [17, 18], [18, 19], [19, 20],
            // Palm
            [5, 9], [9, 13], [13, 17]
        ];

        // Draw connections
        this.canvasCtx.strokeStyle = '#00FF00';
        this.canvasCtx.lineWidth = 2;
        connections.forEach(([start, end]) => {
            this.canvasCtx.beginPath();
            this.canvasCtx.moveTo(
                landmarks[start].x * this.canvasElement.width,
                landmarks[start].y * this.canvasElement.height
            );
            this.canvasCtx.lineTo(
                landmarks[end].x * this.canvasElement.width,
                landmarks[end].y * this.canvasElement.height
            );
            this.canvasCtx.stroke();
        });

        // Draw landmarks
        landmarks.forEach((landmark, index) => {
            const x = landmark.x * this.canvasElement.width;
            const y = landmark.y * this.canvasElement.height;

            // Highlight thumb tip (4) and index tip (8)
            if (index === 4 || index === 8) {
                this.canvasCtx.fillStyle = '#FF0000';
                this.canvasCtx.beginPath();
                this.canvasCtx.arc(x, y, 8, 0, 2 * Math.PI);
                this.canvasCtx.fill();
            } else {
                this.canvasCtx.fillStyle = '#00FF00';
                this.canvasCtx.beginPath();
                this.canvasCtx.arc(x, y, 4, 0, 2 * Math.PI);
                this.canvasCtx.fill();
            }
        });

        // Draw line between thumb and index finger
        if (this.thumbTip && this.indexTip) {
            this.canvasCtx.strokeStyle = '#FF00FF';
            this.canvasCtx.lineWidth = 3;
            this.canvasCtx.beginPath();
            this.canvasCtx.moveTo(
                this.thumbTip.x * this.canvasElement.width,
                this.thumbTip.y * this.canvasElement.height
            );
            this.canvasCtx.lineTo(
                this.indexTip.x * this.canvasElement.width,
                this.indexTip.y * this.canvasElement.height
            );
            this.canvasCtx.stroke();
        }
    }

    processGesture() {
        if (!this.thumbTip || !this.indexTip) return;

        // Calculate Euclidean distance between thumb tip and index finger tip
        const dx = this.thumbTip.x - this.indexTip.x;
        const dy = this.thumbTip.y - this.indexTip.y;
        const dz = this.thumbTip.z - this.indexTip.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Display raw distance
        this.distanceValueElement.textContent = distance.toFixed(3);

        // Map distance to MIDI CC value (0-127)
        const minDist = parseFloat(this.minDistanceInput.value);
        const maxDist = parseFloat(this.maxDistanceInput.value);

        // Clamp and normalize distance
        const clampedDistance = Math.max(minDist, Math.min(maxDist, distance));
        const normalized = (clampedDistance - minDist) / (maxDist - minDist);

        // Convert to MIDI range (0-127), so min distance = 0, max distance = 127
        const ccValue = Math.round(normalized * 127);

        // Update display
        this.ccValueElement.textContent = ccValue;

        // Send MIDI CC if value changed
        if (ccValue !== this.lastCCValue) {
            this.sendMIDICC(ccValue);
            this.lastCCValue = ccValue;
        }
    }

    async scanMIDIDevices() {
        try {
            if (!navigator.requestMIDIAccess) {
                throw new Error('Web MIDI API not supported in this browser');
            }

            this.midiAccess = await navigator.requestMIDIAccess();

            // Debug: Log all MIDI ports
            const inputs = Array.from(this.midiAccess.inputs.values());
            const outputs = Array.from(this.midiAccess.outputs.values());
            console.log('MIDI Inputs (browser receives from):', inputs);
            console.log('MIDI Outputs (browser sends to):', outputs);

            // Get all available MIDI outputs (browser sends data TO these)
            this.midiOutputs = Array.from(this.midiAccess.outputs.values());

            // Clear and populate the select element
            this.midiDeviceSelect.innerHTML = '';

            if (this.midiOutputs.length === 0) {
                // No devices found - show message in dropdown
                const noDeviceOption = document.createElement('option');
                noDeviceOption.value = '';
                noDeviceOption.textContent = 'No MIDI devices found';
                this.midiDeviceSelect.appendChild(noDeviceOption);
                this.midiDeviceSelect.disabled = true;

                this.midiStatusElement.textContent = 'No MIDI devices found. Connect a device and rescan.';
                this.midiStatusElement.style.background = '#ff9800';
                return;
            }

            // Add a default option
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = '-- Select a MIDI Device --';
            this.midiDeviceSelect.appendChild(defaultOption);

            // Add each MIDI output to the select
            this.midiOutputs.forEach((output, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = `${output.name} (${output.manufacturer || 'Unknown'})`;
                this.midiDeviceSelect.appendChild(option);
            });

            // Enable the select element
            this.midiDeviceSelect.disabled = false;

            this.midiStatusElement.textContent = `Found ${this.midiOutputs.length} MIDI device(s)`;
            this.midiStatusElement.style.background = '#2a2a2a';
        } catch (error) {
            console.error('MIDI scan error:', error);

            // Show error in dropdown
            this.midiDeviceSelect.innerHTML = '';
            const errorOption = document.createElement('option');
            errorOption.value = '';
            errorOption.textContent = 'Error scanning devices';
            this.midiDeviceSelect.appendChild(errorOption);
            this.midiDeviceSelect.disabled = true;

            this.midiStatusElement.textContent = `MIDI Error: ${error.message}`;
            this.midiStatusElement.style.background = '#f44336';
        }
    }

    onDeviceSelected() {
        const selectedIndex = this.midiDeviceSelect.value;

        if (selectedIndex !== '') {
            // Enable the connect button
            this.connectMidiBtn.disabled = false;
        } else {
            // Disable the connect button
            this.connectMidiBtn.disabled = true;
        }
    }

    async connectMIDI() {
        try {
            const selectedIndex = parseInt(this.midiDeviceSelect.value);

            if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= this.midiOutputs.length) {
                throw new Error('Please select a valid MIDI device');
            }

            this.midiOutput = this.midiOutputs[selectedIndex];

            this.midiStatusElement.textContent = `Connected to ${this.midiOutput.name}`;
            this.midiStatusElement.style.background = '#4CAF50';
            this.connectMidiBtn.textContent = 'Connected';
            this.connectMidiBtn.disabled = true;
            this.scanMidiBtn.disabled = true;
            this.midiDeviceSelect.disabled = true;
        } catch (error) {
            console.error('MIDI connection error:', error);
            this.midiStatusElement.textContent = `Error: ${error.message}`;
            this.midiStatusElement.style.background = '#f44336';
        }
    }

    sendMIDICC(value) {
        if (!this.midiOutput) return;

        const channel = parseInt(this.midiChannelInput.value) - 1; // MIDI channels are 0-15
        const ccNumber = parseInt(this.ccNumberInput.value);

        // MIDI CC message: [status byte, CC number, value]
        // Status byte: 0xB0 + channel (0xB0 = Control Change on channel 1)
        const statusByte = 0xB0 + channel;
        const message = [statusByte, ccNumber, value];

        try {
            this.midiOutput.send(message);
        } catch (error) {
            console.error('Error sending MIDI:', error);
        }
    }

    updateStatus(message, type) {
        this.statusElement.textContent = message;
        this.statusElement.className = `status-${type}`;
    }
}

// Initialize the controller immediately (script is at end of body, so DOM is ready)
new GestureMidiController();
