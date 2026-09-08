import { crc32 } from 'node:zlib';

// Minimal stored (uncompressed) ZIP writer. PhotoMaker takes its reference
// photographs as one archive URL rather than a list of image URLs, and PNG data
// does not deflate usefully, so storing avoids a compression dependency.
// Entries are written in the order given; names must be plain ASCII.
export function zipArchive(entries) {
  const parts=[], directory=[], time=0, date=33, encoder=new TextEncoder();
  let offset=0;
  for (const [name,data] of entries) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(name)) throw new Error('Unsafe archive entry name');
    const filename=Buffer.from(encoder.encode(name)), sum=crc32(data)>>>0;
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,6);local.writeUInt16LE(0,8);
    local.writeUInt16LE(time,10);local.writeUInt16LE(date,12);local.writeUInt32LE(sum,14);
    local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);
    local.writeUInt16LE(filename.length,26);local.writeUInt16LE(0,28);
    const central=Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0,8);central.writeUInt16LE(0,10);
    central.writeUInt16LE(time,12);central.writeUInt16LE(date,14);central.writeUInt32LE(sum,16);
    central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);
    central.writeUInt16LE(filename.length,28);central.writeUInt16LE(0,30);central.writeUInt16LE(0,32);
    central.writeUInt16LE(0,34);central.writeUInt16LE(0,36);central.writeUInt32LE(0,38);central.writeUInt32LE(offset,42);
    parts.push(local,filename,data);directory.push(central,filename);
    offset+=local.length+filename.length+data.length;
  }
  const body=Buffer.concat(directory), end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(0,4);end.writeUInt16LE(0,6);
  end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(body.length,12);end.writeUInt32LE(offset,16);end.writeUInt16LE(0,20);
  return Buffer.concat([...parts,body,end]);
}
