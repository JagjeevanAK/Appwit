import { useEffect, useRef } from 'react';

const HEARTBEAT_INTERVAL = 60000;

export function useSandboxHeartbeat(sandboxId: string | null) {
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (!sandboxId) {
            return;
        }

        const sendHeartbeat = async () => {
            try {
                await fetch(`http://localhost:3000/api/prompt/refresh/${sandboxId}`, {
                    method: 'POST',
                });
            } catch (error) {
                console.error('Failed to send sandbox heartbeat:', error);
            }
        };

        sendHeartbeat();

        intervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [sandboxId]);
}
