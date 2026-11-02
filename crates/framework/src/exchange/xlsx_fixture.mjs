// 测试专用：用 Node 标准库检查工作表 XML，并构造末尾含损坏单元格的 XLSX。
import { readFileSync } from "node:fs";
import { crc32, inflateRawSync } from "node:zlib";

const bytes = readFileSync(process.argv[2]);
const replacement = process.argv[3] && readFileSync(process.argv[3]);
const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
let cursor = bytes.readUInt32LE(end + 16);
const entries = [];
for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
  const nameLength = bytes.readUInt16LE(cursor + 28);
  const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
  const offset = bytes.readUInt32LE(cursor + 42);
  const start =
    offset +
    30 +
    bytes.readUInt16LE(offset + 26) +
    bytes.readUInt16LE(offset + 28);
  const compressed = bytes.subarray(
    start,
    start + bytes.readUInt32LE(cursor + 20),
  );
  let data =
    bytes.readUInt16LE(cursor + 10) === 8
      ? inflateRawSync(compressed)
      : compressed;
  if (name.toString() === "xl/worksheets/sheet1.xml") {
    if (!replacement) {
      process.stdout.write(data);
      process.exit(0);
    }
    data = replacement;
  }
  entries.push({ name, data });
  cursor +=
    46 +
    nameLength +
    bytes.readUInt16LE(cursor + 30) +
    bytes.readUInt16LE(cursor + 32);
}

const local = [];
const central = [];
let offset = 0;
for (const { name, data } of entries) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt32LE(crc32(data), 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  local.push(header, name, data);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50);
  directory.writeUInt16LE(20, 4);
  directory.writeUInt16LE(20, 6);
  directory.writeUInt32LE(crc32(data), 16);
  directory.writeUInt32LE(data.length, 20);
  directory.writeUInt32LE(data.length, 24);
  directory.writeUInt16LE(name.length, 28);
  directory.writeUInt32LE(offset, 42);
  central.push(directory, name);
  offset += header.length + name.length + data.length;
}
const directory = Buffer.concat(central);
const footer = Buffer.alloc(22);
footer.writeUInt32LE(0x06054b50);
footer.writeUInt16LE(entries.length, 8);
footer.writeUInt16LE(entries.length, 10);
footer.writeUInt32LE(directory.length, 12);
footer.writeUInt32LE(offset, 16);
process.stdout.write(Buffer.concat([...local, directory, footer]));
