export class FlvHeader {
    public signature: string;
    public version: number;
    public flags: number;
    public headerSize: number;

    constructor(header: Buffer) {
        const signature = header.toString('utf8', 0, 3);
        const version = header.readUInt8(3);
        const flags = header.readUInt8(4);
        const headerSize = header.readUInt32BE(5);

        if (signature !== 'FLV') throw new Error('Not FLV.');

        this.signature = signature;
        this.version = version;
        this.flags = flags;
        this.headerSize = headerSize;
    }

    buildHeader(): Buffer {
        const header = Buffer.alloc(this.headerSize);

        header.write(this.signature);
        header.writeUInt8(this.version, 3);
        header.writeUInt8(this.flags, 4);
        header.writeUInt32BE(this.headerSize, 5);

        return header;
    }
}

export class FlvPacketHeader {
    public packetHeader: Buffer;
    public prevPacketSize: number;
    public packetType: number;
    public payloadSize: number;
    public timestampLower: number;
    public timestampUpper: number;
    public streamId: number;

    constructor(packetHeader: Buffer) {
        this.packetHeader = packetHeader;
        this.prevPacketSize = packetHeader.readUInt32BE(0);
        this.packetType = packetHeader.readUInt8(4);
        this.payloadSize = packetHeader.readUIntBE(5, 3);
        this.timestampLower = packetHeader.readUIntBE(8, 3);
        this.timestampUpper = packetHeader.readUInt8(11);
        this.streamId = packetHeader.readUIntBE(12, 3);
    }

    buildPacketHeader(): Buffer {
        const packetHeader = Buffer.alloc(15);

        packetHeader.writeUInt32BE(this.prevPacketSize, 0);
        packetHeader.writeUInt8(this.packetType, 4);
        packetHeader.writeUIntBE(this.payloadSize, 5, 3);
        packetHeader.writeUIntBE(this.timestampLower, 8, 3);
        packetHeader.writeUInt8(this.timestampUpper, 11);
        packetHeader.writeUIntBE(this.streamId, 12, 3);

        return packetHeader;
    }
}

export class FlvPacket {
    public header: FlvPacketHeader;
    public payload: Buffer;
    public fullPacketSize: number;

    constructor(packetHeader: FlvPacketHeader, payload: Buffer) {
        this.header = packetHeader;
        this.payload = payload;
        this.fullPacketSize = 15 + packetHeader.payloadSize;
    }

    getType() {
        switch (this.header.packetType) {
            case 8: {
                return 'audio';
            }
            case 9: {
                return 'video';
            }
            case 18: {
                return 'metadata';
            }
            default: {
                return 'unknown';
            }
        }
    }
}
