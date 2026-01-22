
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, StopCircle, RefreshCw, CheckCircle, X, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

interface CameraRecorderProps {
    onCapture: (file: File) => void;
    onCancel: () => void;
}

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
    const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
    const [resolutionInfo, setResolutionInfo] = useState<string>('');

    // Initialisation de la caméra
    const startCamera = useCallback(async () => {
        try {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }

            console.log('📸 Starting camera with facing mode:', facingMode);

            // Constraints pour forcer la meilleure qualité possible (4K ou 1080p)
            const constraints: MediaStreamConstraints = {
                audio: true,
                video: {
                    facingMode: facingMode,
                    width: { ideal: 3840 }, // Try 4K
                    height: { ideal: 2160 },
                }
            };

            const newStream = await navigator.mediaDevices.getUserMedia(constraints);
            setStream(newStream);

            if (videoRef.current) {
                videoRef.current.srcObject = newStream;
                videoRef.current.volume = 0; // Mute preview to avoid feedback loop
            }

            // Check actual resolution
            const videoTrack = newStream.getVideoTracks()[0];
            if (videoTrack) {
                const settings = videoTrack.getSettings();
                const resText = `${settings.width}x${settings.height}`;
                console.log('✅ Camera started at:', resText);
                setResolutionInfo(resText);
            }

        } catch (error) {
            console.error('❌ Error accessing camera:', error);
            toast({
                title: "Erreur caméra",
                description: "Impossible d'accéder à la caméra. Vérifiez les permissions.",
                variant: "destructive"
            });
            onCancel();
        }
    }, [facingMode, onCancel, toast]);

    useEffect(() => {
        startCamera();
        return () => {
            // Cleanup on unmount
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, [startCamera]);

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

    const startRecording = () => {
        if (!stream) return;

        chunksRef.current = [];

        // Essayer les codecs supportés pour la meilleure qualité
        // iOS (Safari) supporte bien video/mp4 ou video/webkit;codecs=h264
        let mimeType = 'video/mp4';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm;codecs=vp9';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'video/webm';
            }
        }

        console.log('🎥 Recording with mimeType:', mimeType);

        try {
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType,
                videoBitsPerSecond: 8000000 // 8 Mbps target
            });

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: mimeType });
                setRecordedBlob(blob);
                const url = URL.createObjectURL(blob);
                setPreviewUrl(url);

                // Stop stream tracks to save battery while reviewing
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start(1000); // Collect chunks every second
            mediaRecorderRef.current = mediaRecorder;
            setIsRecording(true);
        } catch (e) {
            console.error('Failed to start recording:', e);
            toast({
                title: "Erreur enregistrement",
                description: "Format vidéo non supporté par ce navigateur.",
                variant: "destructive"
            });
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    };

    const switchCamera = () => {
        setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
    };

    const handleRetake = () => {
        setRecordedBlob(null);
        setPreviewUrl(null);
        startCamera(); // Restart stream
    };

    const handleConfirm = () => {
        if (recordedBlob) {
            // Create a File object
            const file = new File([recordedBlob], `capture-${Date.now()}.mp4`, {
                type: recordedBlob.type
            });
            onCapture(file);
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Rendu : Mode Revue
    if (recordedBlob && previewUrl) {
        return (
            <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center p-4">
                <video
                    src={previewUrl}
                    controls
                    className="w-full max-h-[80vh] rounded-lg mb-8"
                    autoPlay
                    playsInline
                />
                <div className="flex gap-4">
                    <Button
                        variant="secondary"
                        size="lg"
                        onClick={handleRetake}
                        className="rounded-full px-8 py-6 text-lg"
                    >
                        <RotateCcw className="mr-2 h-5 w-5" />
                        Refaire
                    </Button>
                    <Button
                        size="lg"
                        onClick={handleConfirm}
                        className="rounded-full px-8 py-6 text-lg bg-green-600 hover:bg-green-700"
                    >
                        <CheckCircle className="mr-2 h-5 w-5" />
                        Valider
                    </Button>
                </div>
            </div>
        );
    }

    // Rendu : Mode Capture
    return (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 p-4 z-10 flex justify-between items-center bg-gradient-to-b from-black/50 to-transparent">
                <Button variant="ghost" size="icon" onClick={onCancel} className="text-white">
                    <X className="h-6 w-6" />
                </Button>
                <div className="bg-black/30 backdrop-blur-md px-3 py-1 rounded-full text-white font-mono text-sm">
                    {isRecording ? formatTime(timer) : (resolutionInfo || 'Camera')}
                </div>
                <Button variant="ghost" size="icon" onClick={switchCamera} className="text-white">
                    <RefreshCw className="h-6 w-6" />
                </Button>
            </div>

            {/* Viewfinder */}
            <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="absolute min-w-full min-h-full object-cover"
                />
            </div>

            {/* Controls */}
            <div className="absolute bottom-0 left-0 right-0 p-8 pb-12 flex justify-center items-center bg-gradient-to-t from-black/80 to-transparent">
                {isRecording ? (
                    <button
                        onClick={stopRecording}
                        className="group relative flex items-center justify-center"
                    >
                        <div className="absolute inset-0 rounded-full border-4 border-white opacity-100 group-hover:scale-105 transition-transform" />
                        <div className="w-16 h-16 rounded-lg bg-red-600 flex items-center justify-center animate-pulse">
                            <div className="w-6 h-6 bg-transparent" />
                        </div>
                    </button>
                ) : (
                    <button
                        onClick={startRecording}
                        className="group relative flex items-center justify-center"
                    >
                        <div className="w-20 h-20 rounded-full border-[6px] border-white flex items-center justify-center transition-all group-hover:scale-105 group-active:scale-95">
                            <div className="w-16 h-16 rounded-full bg-red-600" />
                        </div>
                    </button>
                )}
            </div>
        </div>
    );
}
