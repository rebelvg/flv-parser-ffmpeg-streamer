import { FlvHeader, FlvPacketHeader, FlvPacket } from "./flv/flv";
import * as StreamParser from 'stream-parser';
import { Writable } from "stream";

export class FlvStreamParser extends Writable {
    constructor() {
        super();

        (this as any)._bytes(9, this.onHeader);
    }

    onHeader(headerBuffer: Buffer, output: () => void) {
        const header = new FlvHeader(headerBuffer);

        this.emit('flv-header', header);

        if (header.headerSize !== 9) {
            (this as any)._skipBytes(header.headerSize - 9, () => {
                (this as any)._bytes(15, this.onPacketHeader);
            });
        } else {
            (this as any)._bytes(15, this.onPacketHeader);
        }

        output();
    }

    onPacketHeader(packetHeaderBuffer: Buffer, output: () => void) {
        const packetHeader = new FlvPacketHeader(packetHeaderBuffer);

        (this as any)._bytes(packetHeader.payloadSize, (packetPayloadBuffer: Buffer, output: () => void) => {
            this.emit('flv-packet', new FlvPacket(packetHeader, packetPayloadBuffer));

            (this as any)._bytes(15, this.onPacketHeader);

            output();
        });

        output();
    }
}

StreamParser(FlvStreamParser.prototype);
