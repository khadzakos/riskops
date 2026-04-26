package service

// Top 500 US market tickers (S&P 500 components + major indices + ETFs)
// Used for bulk historical data ingestion (10 years lookback).
var USTickerList = []string{
	// Major indices
	"^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX",
	// Broad market ETFs
	"SPY", "QQQ", "IWM", "DIA", "VTI", "VOO", "IVV",
	// Sector ETFs
	"XLK", "XLF", "XLV", "XLE", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE",
	// Technology
	"AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "META", "AMZN", "TSLA", "AVGO", "ORCL",
	"AMD", "INTC", "QCOM", "TXN", "MU", "AMAT", "LRCX", "KLAC", "MRVL", "ADI",
	"CRM", "NOW", "ADBE", "INTU", "PANW", "SNPS", "CDNS", "FTNT", "ANSS", "CTSH",
	"IBM", "HPQ", "HPE", "DELL", "WDC", "STX", "NTAP", "JNPR", "CSCO", "ANET",
	"AKAM", "FFIV", "VRSN", "EPAM", "GLOB", "GDDY", "ZS", "CRWD", "OKTA", "DDOG",
	// Financials
	"JPM", "BAC", "WFC", "GS", "MS", "C", "BLK", "SCHW", "AXP", "COF",
	"USB", "PNC", "TFC", "MTB", "CFG", "FITB", "HBAN", "KEY", "RF", "ZION",
	"BK", "STT", "NTRS", "IVZ", "BEN", "AMG", "TROW", "SEIC", "RJF", "SF",
	"ICE", "CME", "CBOE", "NDAQ", "MKTX", "LPLA", "IBKR", "VIRT", "HOOD", "SOFI",
	"V", "MA", "PYPL", "FIS", "FISV", "GPN", "WEX", "EVTC", "PAYO", "FOUR",
	// Healthcare
	"JNJ", "UNH", "LLY", "PFE", "ABBV", "MRK", "TMO", "ABT", "DHR", "BMY",
	"AMGN", "GILD", "BIIB", "REGN", "VRTX", "MRNA", "BNTX", "ILMN", "IDXX", "IQV",
	"CVS", "CI", "HUM", "CNC", "MOH", "ELV", "HCA", "THC", "UHS", "CYH",
	"MDT", "SYK", "BSX", "EW", "ZBH", "HOLX", "DXCM", "ISRG", "ALGN", "NVCR",
	"BAX", "BDX", "COO", "HSIC", "PDCO", "XRAY", "VTRS", "PRGO", "JAZZ", "INVA",
	// Consumer Discretionary
	"AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "TJX", "LOW", "BKNG", "MAR",
	"HLT", "WYN", "H", "IHG", "CHH", "EXPE", "ABNB", "LYFT", "UBER", "DASH",
	"GM", "F", "RIVN", "LCID", "STLA", "TM", "HMC", "VWAGY", "BMWYY", "MBGYY",
	"ROST", "BBWI", "PVH", "RL", "TPR", "VFC", "HBI", "UAA", "UA", "LEVI",
	"YUM", "QSR", "DPZ", "CMG", "DNUT", "JACK", "WEN", "SHAK", "TXRH", "DINE",
	// Consumer Staples
	"PG", "KO", "PEP", "COST", "WMT", "PM", "MO", "MDLZ", "KHC", "GIS",
	"K", "CPB", "SJM", "CAG", "HRL", "MKC", "CLX", "CHD", "CL", "EL",
	"KMB", "AVP", "COTY", "REV", "EDGEWELL", "SPB", "CENT", "ANDE", "INGR", "LANC",
	// Energy
	"XOM", "CVX", "COP", "EOG", "SLB", "MPC", "PSX", "VLO", "PXD", "DVN",
	"HAL", "BKR", "NOV", "FTI", "OIS", "PTEN", "HP", "NE", "RIG", "VAL",
	"OXY", "APA", "MRO", "HES", "FANG", "PR", "CTRA", "SM", "MTDR", "ESTE",
	"KMI", "WMB", "OKE", "ET", "EPD", "MMP", "PAA", "TRGP", "DT", "ENLC",
	// Industrials
	"GE", "HON", "MMM", "CAT", "DE", "BA", "LMT", "RTX", "NOC", "GD",
	"UPS", "FDX", "CSX", "NSC", "UNP", "CP", "CNI", "WAB", "TRN", "GATX",
	"EMR", "ETN", "ROK", "AME", "PH", "ITW", "DOV", "XYL", "XYLEM", "REXNORD",
	"GWW", "MSC", "FAST", "SNA", "SWK", "TT", "IR", "JCI", "CARR", "OTIS",
	// Materials
	"LIN", "APD", "ECL", "SHW", "PPG", "RPM", "NEM", "FCX", "NUE", "STLD",
	"RS", "CMC", "X", "CLF", "AA", "CENX", "KALU", "ARNC", "ATI", "HWM",
	"DD", "DOW", "LYB", "EMN", "CE", "HUN", "OLN", "WLK", "TROX", "VNTR",
	// Real Estate
	"AMT", "PLD", "CCI", "EQIX", "PSA", "EXR", "AVB", "EQR", "MAA", "UDR",
	"O", "NNN", "STOR", "ADC", "EPRT", "NTST", "PINE", "FCPT", "PECO", "ROIC",
	"SPG", "MAC", "CBL", "WPG", "SKT", "KIM", "REG", "BRX", "RPAI", "SITC",
	// Utilities
	"NEE", "DUK", "SO", "D", "AEP", "EXC", "SRE", "PCG", "ED", "XEL",
	"WEC", "ES", "ETR", "FE", "PPL", "CMS", "NI", "ATO", "LNT", "EVRG",
	// Communication Services
	"GOOGL", "META", "NFLX", "DIS", "CMCSA", "T", "VZ", "TMUS", "CHTR", "DISH",
	"PARA", "WBD", "FOX", "FOXA", "NYT", "GCI", "NWSA", "NWS", "IAC", "ANGI",
	"SNAP", "PINS", "TWTR", "RDDT", "BMBL", "MTCH", "IAC", "ZG", "TRIP", "YELP",
	// Additional large caps
	"BRK-B", "BRK-A", "SPGI", "MCO", "MSCI", "VRSK", "CSGP", "CPRT", "CBRE", "JLL",
	"ZTS", "IDEXX", "PODD", "INSP", "NTRA", "EXAS", "NVAX", "SRPT", "BLUE", "EDIT",
}

// Top 100 Russian market tickers (MOEX components + major indices)
// Used for bulk historical data ingestion (10 years lookback).
var RUTickerList = []string{
	// Russian indices
	"IMOEX", "RTSI", "MOEXBC", "MOEXOG", "MOEXFN", "MOEXMM", "MOEXCN", "MOEXTL",
	// Blue chips
	"SBER", "GAZP", "LKOH", "NVTK", "ROSN", "TATN", "SNGS", "SNGSP",
	"GMKN", "POLY", "PLZL", "ALRS", "CHMF", "NLMK", "MAGN", "MTLR",
	"YNDX", "MAIL", "OZON", "VKCO", "TCSG", "SBERP", "VTBR", "AFKS",
	// Financials
	"MOEX", "BSPB", "CBOM", "SFIN", "RENI", "INGR", "QIWI", "FESH",
	// Energy & Resources
	"TRNFP", "SIBN", "BANE", "BANEP", "IRAO", "FEES", "HYDR", "RUAL",
	"PHOR", "AKRN", "KAZT", "NKNC", "NKNCP", "KZOS", "KZOSP", "URKZ",
	// Consumer & Retail
	"MGNT", "FIVE", "LENT", "FIXP", "MVID", "DSKY", "APTK", "BELU",
	"ABRD", "GCHE", "KROT", "KROTP", "MFON", "NSVZ", "PRFN", "RBCM",
	// Telecom & Tech
	"MTSS", "RTKM", "RTKMP", "TTLK", "MGTSP", "CIAN", "HHRU", "POSI",
	"ASTR", "DIAS", "SOFL", "WUSH", "RNFT", "SPBE", "LSRG", "PIKK",
	// Transport & Infrastructure
	"AFLT", "FLOT", "NMTP", "NCSP", "GLTR", "GRNT", "TRMK", "UWGN",
	// Real Estate & Construction
	"SMLT", "ETLN", "INGRAD", "LSR", "ETALON", "SAMOLET", "PIK", "DOMO",
	// Misc
	"AQUA", "GTRK", "HIMCP", "KLSB", "KUBE", "LSNG", "LSNGP", "MRKC",
	"MRKP", "MRKS", "MRKU", "MRKV", "MRKZ", "MSNG", "MSRS", "MSTT",
}
