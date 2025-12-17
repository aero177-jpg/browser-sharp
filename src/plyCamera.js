import { PlyReader } from "@sparkjsdev/spark";

const FIELD_BYTES = {
  char: 1,
  uchar: 1,
  short: 2,
  ushort: 2,
  int: 4,
  uint: 4,
  float: 4,
  double: 8,
};

const readScalar = (dataView, offset, type, littleEndian) => {
  switch (type) {
    case "char":
      return dataView.getInt8(offset);
    case "uchar":
      return dataView.getUint8(offset);
    case "short":
      return dataView.getInt16(offset, littleEndian);
    case "ushort":
      return dataView.getUint16(offset, littleEndian);
    case "int":
      return dataView.getInt32(offset, littleEndian);
    case "uint":
      return dataView.getUint32(offset, littleEndian);
    case "float":
      return dataView.getFloat32(offset, littleEndian);
    case "double":
      return dataView.getFloat64(offset, littleEndian);
    default:
      throw new Error(`Unsupported PLY field type: ${type}`);
  }
};

const computeStrideForItem = (properties, dataView, itemOffset, littleEndian) => {
  let offset = itemOffset;
  const listLengths = {};

  for (const [propertyName, property] of properties) {
    if (!property.isList) {
      const bytes = FIELD_BYTES[property.type];
      if (bytes == null) {
        throw new Error(`Unsupported PLY field type: ${property.type}`);
      }
      offset += bytes;
      continue;
    }

    const countType = property.countType;
    const countTypeBytes = FIELD_BYTES[countType];
    const valueBytes = FIELD_BYTES[property.type];
    if (countTypeBytes == null || valueBytes == null) {
      throw new Error(`Unsupported PLY list field types: ${countType}, ${property.type}`);
    }

    const length = readScalar(dataView, offset, countType, littleEndian);
    offset += countTypeBytes;
    listLengths[propertyName] = length;
    offset += length * valueBytes;
  }

  return { stride: offset - itemOffset, listLengths };
};

const computeElementStrideInfo = (element, dataView, elementOffset, littleEndian) => {
  const properties = Object.entries(element.properties);
  const hasLists = properties.some(([, prop]) => prop.isList);

  if (!hasLists) {
    const stride = properties.reduce((sum, [, prop]) => sum + FIELD_BYTES[prop.type], 0);
    return { stride, constant: true };
  }

  if (element.count <= 0) {
    return { stride: 0, constant: true };
  }

  const first = computeStrideForItem(properties, dataView, elementOffset, littleEndian);
  if (element.count === 1) {
    return { stride: first.stride, constant: true };
  }

  const secondOffset = elementOffset + first.stride;
  const second = computeStrideForItem(properties, dataView, secondOffset, littleEndian);

  if (second.stride !== first.stride) {
    return { stride: first.stride, constant: false };
  }

  for (const [key, value] of Object.entries(first.listLengths)) {
    if (second.listLengths[key] !== value) {
      return { stride: first.stride, constant: false };
    }
  }

  return { stride: first.stride, constant: true };
};

const skipElement = (element, dataView, elementOffset, littleEndian) => {
  if (element.count <= 0) return elementOffset;

  const properties = Object.entries(element.properties);
  const hasLists = properties.some(([, prop]) => prop.isList);

  if (!hasLists) {
    const stride = properties.reduce((sum, [, prop]) => sum + FIELD_BYTES[prop.type], 0);
    return elementOffset + element.count * stride;
  }

  const strideInfo = computeElementStrideInfo(
    element,
    dataView,
    elementOffset,
    littleEndian,
  );
  if (strideInfo.constant) {
    return elementOffset + element.count * strideInfo.stride;
  }

  let offset = elementOffset;
  for (let index = 0; index < element.count; index += 1) {
    offset += computeStrideForItem(properties, dataView, offset, littleEndian).stride;
  }
  return offset;
};

const readSinglePropertyElement = (element, dataView, elementOffset, littleEndian) => {
  const properties = Object.entries(element.properties);
  if (properties.length !== 1) return null;

  const [propertyName, property] = properties[0];
  if (property.isList) return null;

  const stride = FIELD_BYTES[property.type];
  if (stride == null) {
    throw new Error(`Unsupported PLY field type: ${property.type}`);
  }

  const values = new Array(element.count);
  let offset = elementOffset;
  for (let i = 0; i < element.count; i += 1) {
    values[i] = readScalar(dataView, offset, property.type, littleEndian);
    offset += stride;
  }

  return { propertyName, values, nextOffset: offset };
};

const toExtrinsic4x4RowMajor = (raw) => {
  if (!raw) {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  if (raw.length === 16) return [...raw];

  if (raw.length === 12) {
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

    m[0] = raw[0];
    m[1] = raw[1];
    m[2] = raw[2];
    m[3] = raw[3];

    m[4] = raw[4];
    m[5] = raw[5];
    m[6] = raw[6];
    m[7] = raw[7];

    m[8] = raw[8];
    m[9] = raw[9];
    m[10] = raw[10];
    m[11] = raw[11];

    const r00 = m[0];
    const r01 = m[1];
    const r02 = m[2];
    const r10 = m[4];
    const r11 = m[5];
    const r12 = m[6];
    const r20 = m[8];
    const r21 = m[9];
    const r22 = m[10];

    m[0] = r00;
    m[1] = r10;
    m[2] = r20;
    m[4] = r01;
    m[5] = r11;
    m[6] = r21;
    m[8] = r02;
    m[9] = r12;
    m[10] = r22;

    return m;
  }

  throw new Error(`Unrecognized extrinsic element length: ${raw.length}`);
};

const parseIntrinsics = (raw, imageWidth, imageHeight) => {
  if (!raw) return null;

  if (raw.length === 9) {
    if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) return null;
    return {
      fx: raw[0],
      fy: raw[4],
      cx: raw[2],
      cy: raw[5],
      imageWidth,
      imageHeight,
    };
  }

  if (raw.length === 16) {
    if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) return null;
    return {
      fx: raw[0],
      fy: raw[5],
      cx: raw[2],
      cy: raw[6],
      imageWidth,
      imageHeight,
    };
  }

  if (raw.length === 4) {
    const legacyWidth = Number.parseInt(raw[2]);
    const legacyHeight = Number.parseInt(raw[3]);
    const width = Number.isFinite(imageWidth) ? imageWidth : legacyWidth;
    const height = Number.isFinite(imageHeight) ? imageHeight : legacyHeight;
    return {
      fx: raw[0],
      fy: raw[1],
      cx: (width - 1) * 0.5,
      cy: (height - 1) * 0.5,
      imageWidth: width,
      imageHeight: height,
    };
  }

  return null;
};

export const readPlyCamera = async (fileBytes) => {
  const ply = new PlyReader({ fileBytes });
  await ply.parseHeader();

  if (!ply.data) return null;

  const wanted = new Set(["intrinsic", "extrinsic", "image_size", "color_space"]);
  const raw = {};

  let offset = 0;
  for (const [elementName, element] of Object.entries(ply.elements)) {
    if (wanted.has(elementName)) {
      const read = readSinglePropertyElement(element, ply.data, offset, ply.littleEndian);
      if (read) {
        raw[elementName] = read.values;
        offset = read.nextOffset;
        continue;
      }
    }

    offset = skipElement(element, ply.data, offset, ply.littleEndian);
  }

  const imageSize = raw.image_size;
  const imageWidth = imageSize?.[0];
  const imageHeight = imageSize?.[1];
  const intrinsics = parseIntrinsics(raw.intrinsic, imageWidth, imageHeight);
  if (!intrinsics) return null;

  return {
    intrinsics,
    extrinsicCv: toExtrinsic4x4RowMajor(raw.extrinsic),
    colorSpaceIndex: raw.color_space?.[0],
    headerComments: ply.comments ?? [],
  };
};
