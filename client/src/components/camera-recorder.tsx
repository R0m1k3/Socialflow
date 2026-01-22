
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, StopCircle, RefreshCw, CheckCircle, X, RotateCcw, Settings2, AlertCircle, Bug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface CameraRecorderProps {
    onCapture: (file: File) => void;
    onCancel: () => void;
}

// Quality configurations
type VideoQuality = "4k" | "1080p" | "720p";

interface QualityConfig {
    label: string;
    width: number;
    height: number;
    bitrate: number;
}

const QUALITY_CONFIGS: Record<VideoQuality, QualityConfig> = {
    "4k": { label: "4K Ultra HD", width: 3840, height: 2160, bitrate: 25000000 },
    "1080p": { label: "Full HD", width: 1920, height: 1080, bitrate: 8000000 },
    "720p": { label: "HD 720p", width: 1280, height: 720, bitrate: 5000000 },
};

export function CameraRecorder({ onCapture, onCancel }: CameraRecorderProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const { toast } = useToast();

    const [stream, setStream] = useState<MediaStream | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [timer, setTimer] = useState(0);

    // Camera Device State
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
    const [permissionError, setPermissionError] = useState<string | null>(null);

    const [resolutionInfo, setResolutionInfo] = useState<string>('');
    const [quality, setQuality] = useState<VideoQuality>('1080p');
    const [showSettings, setShowSettings] = useState(false);
    const [showDebug, setShowDebug] = useState(false);

    // Initial Device Fetch
    useEffect(() => {
        const getDevices = async () => {
            try {
                // Request permission first to get device labels
                await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

                const allDevices = await navigator.mediaDevices.enumerateDevices();
                const videoDevices = allDevices.filter(device => device.kind === 'videoinput');
                setDevices(videoDevices);
                console.log("Devices found:", videoDevices);

                if (videoDevices.length > 0 && !selectedDeviceId) {
                    setSelectedDeviceId(videoDevices[0].deviceId);
                }
            } catch (err) {
                console.error("Error enumerating devices:", err);
                setPermissionError("Accès caméra refusé. Vérifiez les permissions du navigateur.");
            }
        };
        getDevices();
    }, []);

    // Camera Start Logic
    const startCamera = useCallback(async () => {
        try {
            setPermissionError(null);

            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }

            const config = QUALITY_CONFIGS[quality];
            console.log(`📸 Starting camera: ${config.label}, deviceId: ${selectedDeviceId}`);

            // Constraints
            const constraints: MediaStreamConstraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                },
                video: selectedDeviceId ? {
                    deviceId: { exact: selectedDeviceId },
                    width: { ideal: config.width },
                    height: { ideal: config.height },
                } : {
                    facingMode: 'user',
                    width: { ideal: config.width },
                    height: { ideal: config.height },
                }
            };

            let newStream: MediaStream;

            try {
                newStream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (err) {
                console.warn('⚠️ Standard constraints failed:', err);
                setPermissionError(`Erreur: ${err instanceof Error ? err.message : String(err)}`);
                // Fallback
                newStream = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: true
                });
            }

            setStream(newStream);

            if (videoRef.current) {
                videoRef.current.srcObject = newStream;
                videoRef.current.volume = 0;
                await videoRef.current.play();
            }

            // Resolution check
            const videoTrack = newStream.getVideoTracks()[0];
            if (videoTrack) {
                const settings = videoTrack.getSettings();
                setResolutionInfo(`${settings.width}x${settings.height}`);
            }

        } catch (error) {
            console.error('❌ Error accessing camera:', error);
            const msg = error instanceof Error ? error.message : "Erreur inconnue";
            setPermissionError(msg);
            toast({
                title: "Erreur caméra",
                description: msg,
                variant: "destructive"
            });
        }
    }, [selectedDeviceId, quality, toast]);

    // Restart on quality/device change
    useEffect(() => {
        if (selectedDeviceId || devices.length === 0) {
            // Attempt start even if no devices found (might work with default)
            startCamera();
        }
        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDeviceId, quality]);

    // Timer logic
    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isRecording) {
            interval = setInterval(() => {
                setTimer(prev => prev + 1);
            }, 1000);
        } else {
            setTimer(0);
        }
        return () => clearInterval(interval);
    }, [isRecording]);

    // Recording Functions
    const startRecording = () => {
        if (!stream) return;
        chunksRef.current = [];

        // Codec selection
        const mimeTypes = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
        const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';

        try {
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType,
                videoBitsPerSecond: 8000000
            });

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: mimeType || 'video/webm' });
                setRecordedBlob(blob);
                setPreviewUrl(URL.createObjectURL(blob));
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start(1000);
            mediaRecorderRef.current = mediaRecorder;
            setIsRecording(true);
        } catch (e) {
            console.error('Recording failed:', e);
            toast({ title: "Erreur enregistrement", description: "Format non supporté.", variant: "destructive" });
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    };

    const handleConfirm = () => {
        if (recordedBlob) {
            onCapture(new File([recordedBlob], `capture-${Date.now()}.mp4`, { type: recordedBlob.type }));
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Render Review Mode
    if (recordedBlob && previewUrl) {
        return (
            <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center p-4">
                <video src={previewUrl} controls className="w-full max-h-[80vh] rounded-lg mb-8" autoPlay playsInline />
                <div className="flex gap-4">
                    <Button variant="secondary" size="lg" onClick={() => { setRecordedBlob(null); startCamera(); }} className="rounded-full px-8 py-6 text-lg">
                        <RotateCcw className="mr-2 h-5 w-5" /> Refaire
                    </Button>
                    <Button size="lg" onClick={handleConfirm} className="rounded-full px-8 py-6 text-lg bg-green-600 hover:bg-green-700">
                        <CheckCircle className="mr-2 h-5 w-5" /> Valider
                    </Button>
                </div>
            </div>
        );
    }

    // Render Capture Mode
    return (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
            {/* Header / Top Bar */}
            <div className="absolute top-0 left-0 right-0 p-4 z-10 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
                <div className="pointer-events-auto">
                    <Button variant="ghost" size="icon" onClick={onCancel} className="text-white">
                        <X className="h-6 w-6" />
                    </Button>
                </div>

                <div className="flex items-center gap-2 pointer-events-auto">
                    {/* Debug Toggle */}
                    <button onClick={() => setShowDebug(!showDebug)} className="bg-red-900/50 p-2 rounded text-xs text-white">
                        <Bug className="h-4 w-4" />
                    </button>

                    {isRecording ? (
                        <div className="bg-red-600 px-3 py-1 rounded-full text-white font-mono text-sm flex items-center gap-2">
                            <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
                            {formatTime(timer)}
                        </div>
                    ) : (
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className="bg-black/50 backdrop-blur-md px-3 py-2 rounded-full text-white font-medium text-sm flex items-center gap-2 border border-white/30 hover:bg-black/70 transition-colors"
                        >
                            <Settings2 className="h-4 w-4" />
                            <span className="hidden sm:inline">Paramètres</span>
                        </button>
                    )}
                </div>
                <div className="w-10"></div>
            </div>

            {/* DEBUG OVERLAY */}
            {showDebug && (
                <div className="absolute top-16 left-4 z-40 bg-black/80 text-green-400 p-4 rounded text-xs font-mono whitespace-pre-wrap max-w-sm pointer-events-auto overflow-auto max-h-[50vh]">
                    <h3 className="font-bold border-b border-green-500 mb-2">Diagnostic Caméra</h3>
                    <p>Secure Context: {window.isSecureContext ? "YES (HTTPS/Local)" : "NO (HTTP) - CAMERA BLOCKED"}</p>
                    <p>Err Permission: {permissionError || "Aucune"}</p>
                    <p>Resolution: {resolutionInfo}</p>
                    <p>Selected Device: {selectedDeviceId || "Auto"}</p>
                    <p>Stream Active: {stream ? "Oui" : "Non"}</p>
                    <hr className="border-green-800 my-2" />
                    <strong>Devices ({devices.length}):</strong>
                    {devices.map((d, i) => (
                        <div key={i} className="mb-1">
                            [{d.kind}] {d.label || "Sans étiquette"} ({d.deviceId.slice(0, 8)}...)
                        </div>
                    ))}
                </div>
            )}

            {/* Critical Error Display */}
            {!window.isSecureContext && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/90 p-6 text-center text-white">
                    <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
                    <h2 className="text-xl font-bold text-red-400">Connexion non sécurisée (HTTP)</h2>
                    <p className="mt-2 text-gray-300">Les navigateurs bloquent l'accès caméra sur les sites non sécurisés (sauf localhost).</p>
                    <p className="mt-2 text-sm text-gray-400">Veuillez passer en HTTPS ou utiliser localhost.</p>
                </div>
            )}

            {/* Regular Error Display */}
            {permissionError && window.isSecureContext && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/90 p-6 text-center text-white">
                    <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                    <h3 className="text-xl font-bold">Erreur : {permissionError}</h3>
                    <Button onClick={startCamera} variant="outline" className="mt-4 text-black">
                        Réessayer
                    </Button>
                </div>
            )}

            {/* Settings Modal */}
            {showSettings && !isRecording && (
                <div className="absolute inset-0 z-20 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-[#1c1c1e] text-white p-6 rounded-2xl w-full max-w-sm border border-white/10 shadow-2xl">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-lg font-bold">Paramètres</h2>
                            <Button variant="ghost" size="icon" onClick={() => setShowSettings(false)}>
                                <X className="h-5 w-5" />
                            </Button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm font-medium text-white/70">Source Vidéo</label>
                                <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
                                    <SelectTrigger className="w-full bg-white/5 border-white/10 text-white mt-1">
                                        <SelectValue placeholder="Choisir caméra" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#2c2c2e] border-white/10 text-white">
                                        {devices.map((device) => (
                                            <SelectItem key={device.deviceId} value={device.deviceId}>
                                                {device.label || `Caméra ${device.deviceId.slice(0, 5)}...`}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-white/70">Qualité</label>
                                <div className="grid grid-cols-3 gap-2 mt-1">
                                    {(Object.keys(QUALITY_CONFIGS) as VideoQuality[]).map((q) => (
                                        <button
                                            key={q}
                                            onClick={() => setQuality(q)}
                                            className={`px-2 py-2 rounded text-sm border ${quality === q ? 'bg-white text-black' : 'bg-transparent text-white border-white/20'}`}
                                        >
                                            {q.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Video Feed */}
            <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="absolute w-full h-full object-cover"
                />
            </div>

            {/* Controls Footer */}
            <div className="absolute bottom-0 left-0 right-0 p-8 pb-12 flex flex-col items-center justify-end bg-gradient-to-t from-black/80 to-transparent h-48 pointer-events-none">
                <div className="pointer-events-auto">
                    <button
                        onClick={isRecording ? stopRecording : startRecording}
                        className="group relative flex items-center justify-center transition-all hover:scale-110 active:scale-95"
                    >
                        <div className={`w-20 h-20 rounded-full border-[6px] border-white flex items-center justify-center p-1 ${isRecording ? 'opacity-100' : ''}`}>
                            <div className={`transition-all duration-300 ${isRecording ? 'w-8 h-8 rounded-md bg-red-500' : 'w-full h-full rounded-full bg-red-500'}`} />
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
}

export default CameraRecorder;
