/**
 * 用户地理位置提取工具
 *
 * 使用 Cloudflare Workers 内置的 request.cf 对象获取用户位置信息
 * 完全免费，无 API 调用限制
 */

interface CfGeoInfo {
  country?: string;
  region?: string;
  city?: string;
  latitude?: string;
  longitude?: string;
  timezone?: string;
  postalCode?: string;
  asOrganization?: string;
}

// 中国省份代码映射（ISO 3166-2:CN）
// 包含中国大陆、香港、澳门、台湾
const CN_REGION_MAP: Record<string, string> = {
  'CN-BJ': '北京市',
  'CN-TJ': '天津市',
  'CN-HE': '河北省',
  'CN-SX': '山西省',
  'CN-NM': '内蒙古自治区',
  'CN-LN': '辽宁省',
  'CN-JL': '吉林省',
  'CN-HL': '黑龙江省',
  'CN-SH': '上海市',
  'CN-JS': '江苏省',
  'CN-ZJ': '浙江省',
  'CN-AH': '安徽省',
  'CN-FJ': '福建省',
  'CN-JX': '江西省',
  'CN-SD': '山东省',
  'CN-HA': '河南省',
  'CN-HB': '湖北省',
  'CN-HN': '湖南省',
  'CN-GD': '广东省',
  'CN-GX': '广西壮族自治区',
  'CN-HI': '海南省',
  'CN-CQ': '重庆市',
  'CN-SC': '四川省',
  'CN-GZ': '贵州省',
  'CN-YN': '云南省',
  'CN-XZ': '西藏自治区',
  'CN-SN': '陕西省',
  'CN-GS': '甘肃省',
  'CN-QH': '青海省',
  'CN-NX': '宁夏回族自治区',
  'CN-XJ': '新疆维吾尔自治区',
  'CN-TW': '台湾省',
  'CN-HK': '香港特别行政区',
  'CN-MO': '澳门特别行政区',
};

// 国家/地区代码映射
const COUNTRY_MAP: Record<string, string> = {
  'CN': '中国',
  'US': '美国',
  'JP': '日本',
  'KR': '韩国',
  'SG': '新加坡',
  'MY': '马来西亚',
  'TH': '泰国',
  'VN': '越南',
  'PH': '菲律宾',
  'ID': '印度尼西亚',
  'AU': '澳大利亚',
  'GB': '英国',
  'DE': '德国',
  'FR': '法国',
  'RU': '俄罗斯',
  'CA': '加拿大',
  'IN': '印度',
};

/**
 * 从请求中提取用户地理位置信息
 *
 * @param request - Cloudflare Workers 的 Request 对象
 * @returns 格式化的位置字符串，如 "中国 福建省 厦门市"，或 undefined（本地开发时）
 */
export function extractUserLocation(request: Request): string | undefined {
  const cf = (request as any).cf as CfGeoInfo | undefined;
  if (!cf) return undefined;

  const parts: string[] = [];

  // 国家/地区
  if (cf.country) {
    // 中国（包括港澳台）
    if (cf.country === 'CN' || cf.country === 'HK' || cf.country === 'MO' || cf.country === 'TW') {
      parts.push('中国');
    } else if (COUNTRY_MAP[cf.country]) {
      parts.push(COUNTRY_MAP[cf.country]);
    } else {
      parts.push(cf.country);
    }
  }

  // 省份/地区（中国省份转换为中文）
  if (cf.region) {
    if (cf.country === 'CN' || cf.country === 'HK' || cf.country === 'MO' || cf.country === 'TW') {
      if (CN_REGION_MAP[cf.region]) {
        parts.push(CN_REGION_MAP[cf.region]);
      } else {
        parts.push(cf.region);
      }
    } else {
      parts.push(cf.region);
    }
  }

  // 城市
  if (cf.city) {
    parts.push(cf.city);
  }

  // 时区
  if (cf.timezone) {
    parts.push(`时区: ${cf.timezone}`);
  }

  return parts.length > 0 ? parts.join(' ') : undefined;
}
