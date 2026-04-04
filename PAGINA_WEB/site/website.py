#!/usr/bin/env python3
"""
McKenna Group — Website nativo (Flask)
Fuente de datos: Google Sheets + MeLi API (fotos vía CDN)
Puerto: 8082
"""

import sys, os, json, time, re, logging, hashlib, sqlite3, uuid
from pathlib import Path
from collections import defaultdict
from datetime import datetime

ROOT = Path(__file__).resolve().parent.parent.parent   # /home/mckg/mi-agente
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / '.env')

from flask import Flask, render_template, request, jsonify, abort, redirect, url_for, session
import requests
import gspread

# ══════════════════════════════════════════════════════════
#  CONFIG
# ══════════════════════════════════════════════════════════
CREDS_PATH = os.getenv(
    "GOOGLE_SERVICE_ACCOUNT_PATH",
    str(ROOT / "mi-agente-ubuntu-9043f67d9755.json")
)
SHEET_ID    = "1v8_8Ibnq0yPkFlS1t-NGM2UMaNd5dxIDjJApl3NbHMg"
MELI_CREDS  = Path(os.getenv("MELI_CREDS_PATH", str(ROOT / "credenciales_meli.json")))
CACHE_FILE  = Path(__file__).parent / "data/cache.json"
FICHAS_FILE = Path(__file__).parent / "data/fichas_tecnicas.json"
CACHE_TTL   = 6 * 3600          # 6 horas
WA_NUMBER   = "573195183596"
SITE_URL    = "https://mckennagroup.co"

# Comisión real de MercadoLibre Colombia (~16.5%)
# El precio web = precio_meli × (1 - MELI_COMMISSION)
# El cliente ahorra la comisión; el envío se cobra por separado (≤ ahorro)
MELI_COMMISSION = 0.165

# Tarifas Interrapidísimo (fuente: app/data/tarifas_interrapidisimo.json)
_tarifas_path = ROOT / "app/data/tarifas_interrapidisimo.json"
try:
    TARIFAS_IR = json.loads(_tarifas_path.read_text())["ciudades"]
except Exception:
    TARIFAS_IR = {"default": {"precio_base": 18000, "dias": 4}}

# Datos geográficos Colombia
COLOMBIA_DATA = {
  "Amazonas":["Leticia","Puerto Nariño","El Encanto","La Chorrera","La Pedrera","La Victoria","Mirití-Paraná","Puerto Alegría","Puerto Arica","Puerto Santander","Tarapacá"],
  "Antioquia":["Medellín","Bello","Itagüí","Envigado","Sabaneta","Rionegro","Apartadó","Turbo","Caucasia","Chigorodó","Copacabana","La Ceja","La Estrella","Marinilla","Caldas","Barbosa","Girardota","El Bagre","Andes","Fredonia","Jericó","Santa Bárbara","Abejorral","Abriaquí","Alejandría","Amagá","Amalfi","Angelópolis","Angostura","Anorí","Anzá","Arboletes","Argelia","Armenia","Betulia","Briceño","Buriticá","Cáceres","Caicedo","Campamento","Cañasgordas","Caracolí","Caramanta","Carepa","Carolina del Príncipe","Cisneros","Cocorná","Concepción","Concordia","Dabeiba","Don Matías","Ebéjico","El Carmen de Viboral","El Peñol","El Retiro","El Santuario","Entrerríos","Frontino","Giraldo","Gómez Plata","Granada","Guadalupe","Guarne","Guatapé","Heliconia","Hispania","Ituango","Jardín","La Pintada","La Unión","Liborina","Maceo","Montebello","Murindó","Mutatá","Nariño","Necoclí","Nechí","Olaya","Peque","Pueblorrico","Puerto Berrío","Puerto Nare","Puerto Triunfo","Remedios","Sabanalarga","Salgar","San Andrés de Cuerquia","San Carlos","San Francisco","San Jerónimo","San José de la Montaña","San Juan de Urabá","San Luis","San Pedro de los Milagros","San Pedro de Urabá","San Rafael","San Roque","San Vicente Ferrer","Santa Rosa de Osos","Santo Domingo","Segovia","Sonsón","Sopetrán","Tamesis","Tarazá","Tarso","Titiribí","Toledo","Uramita","Urrao","Valdivia","Valparaíso","Vegachí","Venecia","Vigía del Fuerte","Yalí","Yarumal","Yolombó","Yondó","Zaragoza"],
  "Arauca":["Arauca","Arauquita","Cravo Norte","Fortul","Puerto Rondón","Saravena","Tame"],
  "Atlántico":["Barranquilla","Soledad","Malambo","Galapa","Sabanalarga","Baranoa","Campo de la Cruz","Candelaria","Juan de Acosta","Luruaco","Manatí","Palmar de Varela","Piojó","Polonuevo","Ponedera","Puerto Colombia","Repelón","Sabanagrande","Santa Lucía","Santo Tomás","Suan","Tubará","Usiacurí"],
  "Bogotá D.C.":["Bogotá D.C."],
  "Bolívar":["Cartagena","Magangué","El Carmen de Bolívar","Turbaco","Mompós","Arjona","Achí","Altos del Rosario","Arenal","Arroyohondo","Barranco de Loba","Calamar","Cantagallo","Cicuco","Clemencia","Córdoba","El Guamo","El Peñón","Hatillo de Loba","Mahates","Margarita","María La Baja","Montecristo","Morales","Norosí","Pinillos","Regidor","Río Viejo","San Cristóbal","San Estanislao","San Fernando","San Jacinto","San Jacinto del Cauca","San Juan Nepomuceno","San Martín de Loba","San Pablo","Santa Catalina","Santa Rosa","Santa Rosa del Sur","Simití","Soplaviento","Talaigua Nuevo","Tiquisio","Turbaná","Villanueva","Zambrano"],
  "Boyacá":["Tunja","Duitama","Sogamoso","Chiquinquirá","Villa de Leyva","Puerto Boyacá","Paipa","Moniquirá","Nobsa","Tibasosa","Aquitania","Arcabuco","Belén","Berbeo","Betéitiva","Boavita","Boyacá","Briceño","Buena Vista","Busbanzá","Caldas","Campohermoso","Cerinza","Chinavita","Chíquiza","Chiscas","Chita","Chitaraque","Chivatá","Chivor","Ciénega","Cómbita","Coper","Corrales","Covarachía","Cubará","Cucaita","Cuítiva","El Cocuy","El Espino","Firavitoba","Floresta","Gachantivá","Gámeza","Garagoa","Guacamayas","Guateque","Guayatá","Güicán","Iza","Jenesano","Jericó","La Capilla","La Uvita","La Victoria","Labranzagrande","Macanal","Maripí","Miraflores","Mongua","Monguí","Motavita","Muzo","Nuevo Colón","Oicatá","Otanche","Pachavita","Páez","Pajarito","Panqueba","Pauna","Paya","Paz de Río","Pesca","Pisba","Quípama","Ramiriquí","Ráquira","Rondón","Saboyá","Sáchica","Samacá","San Eduardo","San José de Pare","San Luis de Gaceno","San Mateo","San Miguel de Sema","San Pablo de Borbur","Santa María","Santa Rosa de Viterbo","Santa Sofía","Santana","Sativasur","Sativanorte","Siachoque","Soatá","Socotá","Socha","Somondoco","Sora","Soracá","Sotaquirá","Susacón","Sutamarchán","Sutatenza","Tasco","Tenza","Tibaná","Tinjacá","Tipacoque","Toca","Togüí","Tópaga","Tota","Turmequé","Tuta","Tutazá","Úmbita","Ventaquemada","Viracachá","Zetaquira"],
  "Caldas":["Manizales","La Dorada","Chinchiná","Riosucio","Salamina","Villamaría","Aguadas","Anserma","Aranzazu","Belalcázar","Filadelfia","La Merced","Manzanares","Marmato","Marquetalia","Marulanda","Neira","Norcasia","Pácora","Palestina","Pensilvania","Risaralda","Samaná","San José","Supía","Victoria","Viterbo"],
  "Caquetá":["Florencia","San Vicente del Caguán","Albania","Belén de los Andaquíes","Cartagena del Chairá","Curillo","El Doncello","El Paujil","La Montañita","Milán","Morelia","Puerto Rico","San José del Fragua","Solano","Solita","Valparaíso"],
  "Casanare":["Yopal","Aguazul","Tauramena","Villanueva","Hato Corozal","Orocué","Paz de Ariporo","Chámeza","La Salina","Maní","Monterrey","Nunchía","Pore","Recetor","Sabanalarga","Sácama","San Luis de Palenque","Támara","Trinidad"],
  "Cauca":["Popayán","Santander de Quilichao","Puerto Tejada","El Tambo","Patía","Corinto","Almaguer","Argelia","Balboa","Bolívar","Buenos Aires","Cajibío","Caldono","Caloto","Florencia","Guachené","Guapi","Inzá","Jambaló","La Sierra","La Vega","López de Micay","Mercaderes","Miranda","Morales","Padilla","Páez","Piamonte","Piendamó","Puracé","Rosas","San Sebastián","Santa Rosa","Silvia","Sotara","Suárez","Sucre","Timbío","Timbiquí","Toribío","Totoró","Villa Rica"],
  "Cesar":["Valledupar","Aguachica","Agustín Codazzi","Bosconia","Astrea","Becerril","Chimichagua","Chiriguaná","Curumaní","El Copey","El Paso","Gamarra","González","La Gloria","La Jagua de Ibirico","La Paz","Manaure Balcón del Cesar","Pailitas","Pelaya","Pueblo Bello","Río de Oro","San Alberto","San Diego","San Martín","Tamalameque"],
  "Chocó":["Quibdó","Istmina","Riosucio","Acandí","Alto Baudó","Atrato","Bagadó","Bahía Solano","Bajo Baudó","Bojayá","Carmen del Darién","Cértegui","Condoto","El Carmen de Atrato","El Litoral del San Juan","Juradó","Lloró","Medio Atrato","Medio Baudó","Medio San Juan","Nóvita","Nuquí","Río Iro","Río Quito","San José del Palmar","Sipí","Tadó","Unguía","Unión Panamericana"],
  "Córdoba":["Montería","Cereté","Lorica","Sahagún","Montelíbano","Ayapel","Buenavista","Canalete","Chimá","Chinú","Ciénaga de Oro","Cotorra","La Apartada","Los Córdobas","Momil","Moñitos","Planeta Rica","Pueblo Nuevo","Puerto Escondido","Puerto Libertador","Purísima de la Concepción","San Andrés de Sotavento","San Antero","San Bernardo del Viento","San Carlos","San José de Uré","San Pelayo","Tierralta","Tuchín","Valencia"],
  "Cundinamarca":["Soacha","Facatativá","Zipaquirá","Chía","Fusagasugá","Mosquera","Madrid","Funza","Cajicá","Girardot","La Mesa","Tocancipá","Sopó","Villeta","Gachancipá","Tabio","Tenjo","El Rosal","Subachoque","Cogua","Nemocón","Ubaté","Simijaca","Agua de Dios","Albán","Anapoima","Anolaima","Apulo","Arbeláez","Beltrán","Bituima","Bojacá","Cabrera","Cachipay","Caparrapí","Cáqueza","Carmen de Carupa","Chaguaní","Chipaque","Choachí","Chocontá","Cota","Cucunubá","El Colegio","El Peñón","Fomeque","Fosca","Fúquene","Gachalá","Gachetá","Gama","Granada","Guachetá","Guaduas","Guasca","Guataquí","Guatavita","Guayabal de Síquima","Guayabetal","Gutiérrez","Jerusalén","Junín","La Calera","La Palma","La Peña","La Vega","Lenguazaque","Macheta","Manta","Medina","Nariño","Nilo","Nimaima","Nocaima","Venecia","Pacho","Paime","Pandi","Paratebueno","Pasca","Puerto Salgar","Pulí","Quebradanegra","Quetame","Quipile","Ricaurte","San Antonio del Tequendama","San Bernardo","San Cayetano","San Francisco","San Juan de Rioseco","Sasaima","Sesquilé","Sibaté","Silvania","Suesca","Supatá","Susa","Sutatausa","Tausa","Tena","Tibacuy","Tibiritá","Tocaima","Topaipí","Ubalá","Ubaque","Une","Útica","Vergara","Vianí","Villa de San Diego de Ubaté","Viotá","Yacopí","Zipacón"],
  "Guainía":["Inírida","Barranco Minas","Cacahual","La Guadalupe","Mapiripana","Morichal","Pana Pana","Puerto Colombia","San Felipe"],
  "Guaviare":["San José del Guaviare","Calamar","El Retorno","Miraflores"],
  "Huila":["Neiva","Pitalito","Garzón","La Plata","Campoalegre","Acevedo","Agrado","Aipe","Algeciras","Altamira","Baraya","Colombia","Elías","Gigante","Guadalupe","Hobo","Iquira","Isnos","La Argentina","Nátaga","Oporapa","Paicol","Palermo","Palestina","Pital","Rivera","Saladoblanco","San Agustín","Santa María","Suaza","Tarqui","Tello","Teruel","Tesalia","Timaná","Villavieja","Yaguará"],
  "La Guajira":["Riohacha","Maicao","Uribia","Fonseca","San Juan del Cesar","Albania","Barrancas","Dibula","Distracción","El Molino","Hatonuevo","La Jagua del Pilar","Manaure","Urumita","Villanueva"],
  "Magdalena":["Santa Marta","Ciénaga","Fundación","El Banco","Aracataca","Plato","Algarrobo","Ariguaní","Cerro de San Antonio","Chivolo","Concordia","El Piñón","El Retén","Guamal","Nueva Granada","Pedraza","Pijiño del Carmen","Pivijay","Puebloviejo","Remolino","Sabanas de San Ángel","Salamina","San Sebastián de Buenavista","San Zenón","Santa Ana","Santa Bárbara de Pinto","Sitionuevo","Tenerife","Zapayán","Zona Bananera"],
  "Meta":["Villavicencio","Acacías","Granada","Cumaral","Restrepo","San Martín","Puerto López","Barranca de Upía","Cabuyaro","Castilla la Nueva","Cubarral","El Calvario","El Castillo","El Dorado","Fuente de Oro","Guamal","La Macarena","La Uribe","Lejanías","Mapiripán","Mesetas","Puerto Concordia","Puerto Gaitán","Puerto Lleras","Puerto Rico","San Carlos de Guaroa","San Juan de Arama","San Juanito","Vista Hermosa"],
  "Nariño":["Pasto","Tumaco","Ipiales","Túquerres","Samaniego","La Unión","El Charco","Barbacoas","Olaya Herrera","Albán","Aldana","Ancuyá","Arboleda","Belén","Buesaco","Chachagüí","Colón","Consacá","Contadero","Córdoba","Cuaspud","Cumbal","Cumbitara","El Peñol","El Rosario","El Tablón de Gómez","El Tambo","Francisco Pizarro","Funes","Guachucal","Guaitarilla","Gualmatán","Iles","Imués","La Cruz","La Florida","La Llanada","La Tola","Leiva","Linares","Los Andes","Magüí","Mallama","Mosquera","Nariño","Ospina","Policarpa","Potosí","Providencia","Puerres","Pupiales","Ricaurte","Roberto Payán","San Bernardo","San Lorenzo","San Pablo","San Pedro de Cartago","Sandoná","Santa Bárbara","Santacruz","Sapuyes","Taminango","Tangua","Yacuanquer"],
  "Norte de Santander":["Cúcuta","Ocaña","Pamplona","Los Patios","Villa del Rosario","Tibú","Ábrego","Arboledas","Bochalema","Bucarasica","Cácota","Cachirá","Chitagá","Convención","Cucutilla","Durania","El Carmen","El Tarra","El Zulia","Gramalote","Hacarí","Herrán","La Esperanza","La Playa","Labateca","Lourdes","Mutiscua","Pamplonita","Puerto Santander","Ragonvalia","Salazar","San Calixto","San Cayetano","Santiago","Sardinata","Silos","Teorama","Toledo","Villa Caro"],
  "Putumayo":["Mocoa","Puerto Asís","Orito","Valle del Guamuez","Villagarzón","Colón","Leguízamo","Puerto Caicedo","Puerto Guzmán","Puerto Leguízamo","San Francisco","San Miguel","Santiago","Sibundoy"],
  "Quindío":["Armenia","Calarcá","Montenegro","Quimbaya","La Tebaida","Buenavista","Circasia","Córdoba","Filandia","Génova","Pijao","Salento"],
  "Risaralda":["Pereira","Dosquebradas","Santa Rosa de Cabal","La Virginia","Apía","Balboa","Belén de Umbría","Guática","La Celia","Marsella","Mistrató","Pueblo Rico","Quinchía","Santuario"],
  "San Andrés y Providencia":["San Andrés","Providencia"],
  "Santander":["Bucaramanga","Floridablanca","Girón","Piedecuesta","Barrancabermeja","San Gil","Socorro","Vélez","Barbosa","Lebrija","Sabana de Torres","Puerto Wilches","Rionegro","San Vicente de Chucurí","Aguada","Albania","Aratoca","Barichara","Betulia","Bolívar","Cabrera","California","Capitanejo","Carcasí","Cepitá","Cerrito","Charalá","Charta","Chima","Chipatá","Cimitarra","Confines","Contratación","Coromoro","Curití","El Carmen de Chucurí","El Guacamayo","El Peñón","El Playón","Encino","Enciso","Galán","Gambita","Guaca","Guadalupe","Guapotá","Guavatá","Güepsa","Hato","Jesús María","Jordán","La Belleza","La Paz","Landázuri","Los Santos","Macaravita","Málaga","Matanza","Mogotes","Molagavita","Ocamonte","Oiba","Onzaga","Palmar","Palmas del Socorro","Páramo","Pinchote","Puente Nacional","Puerto Parra","San Andrés","San Benito","San Joaquín","San José de Miranda","San Miguel","Santa Bárbara","Santa Helena del Opón","Simacota","Suaita","Sucre","Suratá","Tona","Valle de San José","Vetas","Villanueva","Zapatoca"],
  "Sucre":["Sincelejo","Corozal","Sahagún","Sampués","San Marcos","Buenavista","Caimito","Colosó","Coveñas","Chalán","El Roble","Galeras","Guaranda","La Unión","Los Palmitos","Majagual","Morroa","Ovejas","Palmito","San Benito Abad","San Juan de Betulia","San Onofre","San Pedro","Santiago de Tolú","Since","Sucre","Tolú Viejo"],
  "Tolima":["Ibagué","Espinal","Melgar","Honda","Líbano","Mariquita","El Guamo","Chaparral","Alpujarra","Alvarado","Ambalema","Anzoátegui","Armero-Guayabal","Ataco","Cajamarca","Carmen de Apicalá","Casabianca","Coello","Coyaima","Cunday","Dolores","Falan","Flandes","Fresno","Herveo","Icononzo","Lérida","Murillo","Natagaima","Ortega","Palocabildo","Piedras","Planadas","Prado","Purificación","Rioblanco","Roncesvalles","Rovira","Saldaña","San Antonio","San Luis","Santa Isabel","Suárez","Valle de San Juan","Venadillo","Villahermosa","Villarrica"],
  "Valle del Cauca":["Cali","Palmira","Buenaventura","Tuluá","Buga","Cartago","Yumbo","Jamundí","Candelaria","Florida","Pradera","El Cerrito","Ginebra","Guacarí","Alcalá","Andalucía","Ansermanuevo","Argelia","Bolívar","Bugalagrande","Caicedonia","Calima","Dagua","El Águila","El Cairo","El Dovio","La Cumbre","La Unión","La Victoria","Obando","Restrepo","Riofrío","Roldanillo","San Pedro","Sevilla","Toro","Trujillo","Ulloa","Versalles","Vijes","Yotoco","Zarzal"],
  "Vaupés":["Mitú","Carurú","Pacoa","Papunaua","Taraira","Yavaraté"],
  "Vichada":["Puerto Carreño","Cumaribo","La Primavera","Santa Rosalía"],
}

# ── MercadoPago Colombia ─────────────────────────────────
MP_ACCESS_TOKEN   = os.getenv("MP_ACCESS_TOKEN", "")       # APP_USR-...
MP_API            = "https://api.mercadopago.com"

# ── DB órdenes ───────────────────────────────────────────
DB_PATH = Path(__file__).parent / "data/orders.db"

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger("website")

# ══════════════════════════════════════════════════════════
#  CATEGORÍAS (mismo orden que catálogo PDF)
# ══════════════════════════════════════════════════════════
CATEGORY_MAP = [
    (["acd", "ktacd"],                                           "Ácidos"),
    (["oilesn"],                                                  "Aceites Esenciales"),
    (["oil","oilarg","oilgrs","oilbmb","oilsml","oilvrgn",
      "sbcrd","vsl"],                                             "Aceites"),
    (["crcrn","crabjrf","lnln","mntcc","mntk","mntklb",
      "mntccrfkg","mntkkg","mntk250g","mntl100g","mtnkrtkg",
      "prfn"],                                                     "Ceras y Mantecas"),
    (["alcctl","btms","btncc","crlnt","ccmd","tsscc","tsci",
      "pls20","polisb","polsorb","cocamid"],                       "Emulsionantes y Surfactantes"),
    (["alnt","frbsgl","glc","hyal","niac","dprp",
      "srb500","urcsm"],                                           "Humectantes"),
    (["arc"],                                                      "Arcillas"),
    (["bcarna","ctrca","ctmg","ctrmg","clrmg","ctrzn","salmg",
      "salkmg","clrcalb","ctk","srlch"],                           "Sales Minerales"),
    (["oltk","lctca","gmxtn","gmxnt","brxlben","slfcul"],          "Minerales"),
    (["dpnt","vtmb","vtmc","vtma","vtmd","vtme"],                  "Vitaminas"),
    (["bcaa","clgnhd","crtnmnh","els","gltssnbr","prtasl",
      "gelat","albhv","larg","lglt","lisl","lprl",
      "ltrp","trn250"],                                            "Suplementarios"),
    (["cfn","extalvr","extgsn","extmlt","extemtc","mltdxtr",
      "mltdxlb","algna","cmcph","cmclb","coloid","extmat",
      "gmsn","actnalb","agag","almyc","cpsvcglt","dxdtlb",
      "dxtkg","estmglb","gltmns","gmgr","inl","lctsyl",
      "ppn","agdst","h2ors"],                                      "Excipientes"),
    (["shrmx","shrx","phemx","dmdm","benz","propgl",
      "potsorb","sodbnz","bnznalb","mtbslfn","srbk","srbtkg"],     "Conservantes"),
    (["alls","erttlb","frct","stvia","xylitol","crmtrt",
      "scr250"],                                                    "Edulcorantes"),
    (["dha","as-96","retinol","rtn5p","niacin","kojic",
      "alfarb","dmso","oxdzn","mntl100","vltgn"],                  "Principios Activos"),
    (["kt","kit"],                                                  "Kits"),
    (["agtmgn","bkr","gtrvdr","gtrvdramb","gtr","ppmt",
      "termm","piseta","filtro","embudo","cchmzcpls",
      "glslcarn","rvv","tds/eh"],                                   "Equipos y Materiales"),
    (["almlijmkt","brcesc","extelc","frspdrmttx","as-15",
      "pnttrscbl","ktext","repuesto","dscvdr","flnpvc",
      "owofan"],                                                    "Herramientas"),
    (["azm","glt2p","crbact"],                                     "Agrícola"),
    (["as-44","as-86","as-38","collar","mascot"],                  "Mascotas"),
]

CAT_COLORS = {
    "Ácidos":                     "#143D36",
    "Aceites Esenciales":         "#1E5C51",
    "Aceites":                    "#2E8B7A",
    "Ceras y Mantecas":           "#3A9E8C",
    "Emulsionantes y Surfactantes":"#1E5C51",
    "Humectantes":                "#4DB3A0",
    "Arcillas":                   "#6B8F71",
    "Sales Minerales":            "#2E8B7A",
    "Minerales":                  "#143D36",
    "Vitaminas":                  "#1E5C51",
    "Suplementarios":             "#2E8B7A",
    "Excipientes":                "#3A9E8C",
    "Conservantes":               "#143D36",
    "Edulcorantes":               "#4DB3A0",
    "Principios Activos":         "#1E5C51",
    "Kits":                       "#2E8B7A",
    "Equipos y Materiales":       "#143D36",
    "Herramientas":               "#1E5C51",
    "Agrícola":                   "#6B8F71",
    "Mascotas":                   "#2E8B7A",
    "Otros":                      "#888888",
}


def categorize(sku: str) -> str:
    sl = sku.strip().lower()
    for prefixes, cat in CATEGORY_MAP:
        for pfx in prefixes:
            if sl.startswith(pfx) or sl == pfx:
                return cat
    return "Otros"


# ══════════════════════════════════════════════════════════
#  TOKEN MELI
# ══════════════════════════════════════════════════════════
def get_meli_token() -> str:
    try:
        with open(MELI_CREDS) as f:
            creds = json.load(f)
        token = creds.get("access_token", "")
        if token:
            return token
    except Exception as e:
        log.warning(f"No se pudo leer token MeLi: {e}")
    return ""


# ══════════════════════════════════════════════════════════
#  FOTOS MELI (retorna URLs CDN, no descarga localmente)
# ══════════════════════════════════════════════════════════
def fetch_meli_photo_urls(token: str, meli_id_to_sku: dict) -> dict:
    """Retorna {sku: url_foto_meli}"""
    if not token or not meli_id_to_sku:
        return {}

    headers   = {"Authorization": f"Bearer {token}"}
    item_ids  = list(meli_id_to_sku.keys())
    sku_photo = {}

    for i in range(0, len(item_ids), 20):
        batch = item_ids[i:i+20]
        try:
            res = requests.get(
                "https://api.mercadolibre.com/items",
                params={"ids": ",".join(batch), "attributes": "id,pictures,price,available_quantity"},
                headers=headers, timeout=15
            )
            if res.status_code != 200:
                continue
            for entry in res.json():
                if entry.get("code") != 200:
                    continue
                body    = entry.get("body", {})
                item_id = body.get("id", "")
                sku     = meli_id_to_sku.get(item_id, "")
                if not sku:
                    continue
                pics = body.get("pictures", [])
                if pics:
                    url = pics[0].get("secure_url") or pics[0].get("url", "")
                    if url:
                        sku_photo[sku] = url
        except Exception as e:
            log.warning(f"Error batch fotos MeLi: {e}")

    log.info(f"  {len(sku_photo)} fotos obtenidas de MeLi CDN")
    return sku_photo


# ══════════════════════════════════════════════════════════
#  FICHAS TÉCNICAS (Word → JSON)
# ══════════════════════════════════════════════════════════
_fichas_cache: dict = {}

def _norm_ficha(texto: str) -> str:
    t = texto.lower().strip()
    for a, b in [("á","a"),("é","e"),("í","i"),("ó","o"),("ú","u"),("ñ","n")]:
        t = t.replace(a, b)
    return re.sub(r"[^a-z0-9 ]", " ", t).strip()


def load_fichas() -> dict:
    global _fichas_cache
    if _fichas_cache:
        return _fichas_cache
    try:
        _fichas_cache = json.loads(FICHAS_FILE.read_text(encoding="utf-8"))
        log.info(f"Fichas técnicas cargadas: {len(_fichas_cache)}")
    except Exception as e:
        log.warning(f"No se pudieron cargar fichas técnicas: {e}")
        _fichas_cache = {}
    return _fichas_cache


def buscar_ficha(nombre_producto: str) -> dict | None:
    """Busca la ficha técnica más específica para un nombre de producto.

    Estrategias (de mayor a menor prioridad):
    1. Todas las palabras de la clave están presentes en el nombre (exacto)
    2. Las primeras 2 palabras de la clave están en el nombre (fallback para claves con números)
    """
    fichas = load_fichas()
    if not fichas:
        return None
    nombre_norm    = _norm_ficha(nombre_producto)
    nombre_palabras = set(nombre_norm.split())

    # Estrategia 1: todas las palabras de la clave presentes
    mejor_clave, mejor_score = None, 0
    for clave in fichas:
        clave_palabras = set(clave.split())
        if clave_palabras and clave_palabras.issubset(nombre_palabras):
            score = len(clave)  # preferir la clave más específica (más larga)
            if score > mejor_score:
                mejor_clave, mejor_score = clave, score

    if mejor_clave:
        return fichas[mejor_clave]

    # Estrategia 2: primeras 2 palabras de la clave (ignora número de versión)
    for clave in fichas:
        clave_palabras = clave.split()
        if len(clave_palabras) >= 2:
            prefijo = set(clave_palabras[:2])
            if prefijo.issubset(nombre_palabras):
                score = len(" ".join(clave_palabras[:2]))
                if score > mejor_score:
                    mejor_clave, mejor_score = clave, score

    return fichas.get(mejor_clave) if mejor_clave else None


# ══════════════════════════════════════════════════════════
#  LEER CATÁLOGO DESDE SHEETS
# ══════════════════════════════════════════════════════════
def leer_catalogo() -> list:
    """Lee Google Sheets y retorna lista de secciones con productos."""
    log.info("Conectando con Google Sheets...")
    gc = gspread.service_account(filename=CREDS_PATH)
    wb = gc.open_by_key(SHEET_ID)
    ws = wb.sheet1
    rows = ws.get_all_values()
    log.info(f"  {len(rows)-1} filas en Sheets")

    header     = [h.strip().upper() for h in rows[0]]
    idx_meli   = 0
    idx_sku    = next((i for i, h in enumerate(header) if "SKU"    in h), 1)
    idx_nombre = next((i for i, h in enumerate(header) if "NOMBRE" in h), 3)
    idx_precio = next((i for i, h in enumerate(header) if "PRECIO" in h), 4)
    idx_desc   = next((i for i, h in enumerate(header) if any(k in h for k in ["FICHA","TDS","DESC","TECNICA","TÉCNICA"])), 8)

    seen       = set()
    sections   = defaultdict(list)
    id_to_sku  = {}

    for row in rows[1:]:
        if len(row) <= max(idx_sku, idx_nombre, idx_precio):
            continue
        meli_id    = str(row[idx_meli]).strip().upper() if row[idx_meli] else ""
        sku        = row[idx_sku].strip()
        nombre     = row[idx_nombre].strip()
        precio_raw = row[idx_precio].strip()
        desc_raw   = row[idx_desc].strip() if len(row) > idx_desc else ""

        if not sku or not nombre or not precio_raw or sku in seen:
            continue
        seen.add(sku)

        if meli_id.startswith("MCO"):
            id_to_sku[meli_id] = sku

        try:
            precio_meli = float(precio_raw.replace(",", "").replace("$", "").replace(" ", ""))
            if precio_meli <= 0:
                continue
        except ValueError:
            continue

        precio_desc = precio_meli * (1 - MELI_COMMISSION)
        ahorro      = precio_meli * MELI_COMMISSION

        def fmt(n): return f"${n:,.0f}".replace(",", ".")

        cat   = categorize(sku)
        ficha = buscar_ficha(nombre)
        sections[cat].append({
            "name":       nombre,
            "ref":        sku,
            "precio":     fmt(precio_desc),
            "precio_meli":fmt(precio_meli),
            "ahorro":     fmt(ahorro),
            "photo":      None,
            "meli_id":    meli_id if meli_id.startswith("MCO") else "",
            "cat":        cat,
            "cat_color":  CAT_COLORS.get(cat, "#2E8B7A"),
            "slug":       re.sub(r"[^a-z0-9\-]", "-", sku.lower()),
            "desc":       desc_raw[:450] if desc_raw else "",
            "ficha":      ficha,
        })

    # Fotos desde MeLi
    token     = get_meli_token()
    photo_map = fetch_meli_photo_urls(token, id_to_sku)
    for prods in sections.values():
        for p in prods:
            p["photo"] = photo_map.get(p["ref"], "")

    # Ordenar secciones
    orden = [cat for _, cat in CATEGORY_MAP] + ["Otros"]
    seen_ord, orden_final = set(), []
    for c in orden:
        if c not in seen_ord:
            seen_ord.add(c)
            orden_final.append(c)

    result = []
    for cat in orden_final:
        if cat in sections and sections[cat]:
            prods = sorted(sections[cat], key=lambda p: p["name"].lower())
            result.append({"name": cat, "products": prods})
    for cat, prods in sections.items():
        if cat not in seen_ord and prods:
            result.append({"name": cat, "products": sorted(prods, key=lambda p: p["name"].lower())})

    total = sum(len(s["products"]) for s in result)
    log.info(f"Catálogo listo: {len(result)} categorías, {total} productos")
    return result


# ══════════════════════════════════════════════════════════
#  CACHE
# ══════════════════════════════════════════════════════════
_catalog_cache = {"data": None, "ts": 0}

def get_catalog(force=False) -> list:
    now = time.time()
    if not force and _catalog_cache["data"] and (now - _catalog_cache["ts"]) < CACHE_TTL:
        return _catalog_cache["data"]

    # Intentar cargar desde archivo
    if not force and CACHE_FILE.exists():
        age = now - CACHE_FILE.stat().st_mtime
        if age < CACHE_TTL:
            try:
                data = json.loads(CACHE_FILE.read_text())
                _catalog_cache.update({"data": data, "ts": now})
                log.info(f"Catálogo cargado desde cache ({int(age/60)} min)")
                return data
            except Exception:
                pass

    # Construir catálogo fresco
    try:
        data = leer_catalogo()
        _catalog_cache.update({"data": data, "ts": now})
        CACHE_FILE.parent.mkdir(exist_ok=True)
        CACHE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2))
        log.info("Cache guardado en disco")
        return data
    except Exception as e:
        log.error(f"Error construyendo catálogo: {e}")
        if _catalog_cache["data"]:
            return _catalog_cache["data"]
        if CACHE_FILE.exists():
            return json.loads(CACHE_FILE.read_text())
        return []


def get_all_products(catalog=None) -> list:
    if catalog is None:
        catalog = get_catalog()
    return [p for section in catalog for p in section["products"]]


def find_product(sku: str) -> dict | None:
    for p in get_all_products():
        if p["ref"].lower() == sku.lower() or p["slug"] == sku.lower():
            return p
    return None


def wa_link(producto: dict) -> str:
    msg = (f"Hola, quiero ordenar: *{producto['name']}* "
           f"(Ref: {producto['ref']}) — {producto['precio']} COP")
    return f"https://wa.me/{WA_NUMBER}?text={requests.utils.quote(msg)}"


# ══════════════════════════════════════════════════════════
#  FLASK APP
# ══════════════════════════════════════════════════════════
def init_db():
    DB_PATH.parent.mkdir(exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            reference   TEXT UNIQUE,
            buyer_name  TEXT,
            buyer_email TEXT,
            buyer_phone TEXT,
            buyer_city  TEXT,
            items_json  TEXT,
            total       REAL,
            status      TEXT DEFAULT 'pending',
            payu_ref    TEXT,
            created_at  TEXT
        )
    """)
    con.commit()
    con.close()

def mp_crear_preferencia(ref: str, cart: dict, total: float, shipping: float = 0.0) -> dict:
    """Crea una preferencia de pago en MercadoPago y retorna {init_point, id}."""
    items = []
    for item in cart.values():
        items.append({
            "title":      item["name"][:256],
            "quantity":   item["qty"],
            "unit_price": round(item["price"]),
            "currency_id": "COP",
        })
    if shipping > 0:
        items.append({
            "title":      "Envío Interrapidísimo",
            "quantity":   1,
            "unit_price": round(shipping),
            "currency_id": "COP",
        })
    payload = {
        "items": items,
        "external_reference": ref,
        "back_urls": {
            "success": SITE_URL + "/pago/respuesta?estado=aprobado",
            "failure": SITE_URL + "/pago/respuesta?estado=rechazado",
            "pending": SITE_URL + "/pago/respuesta?estado=pendiente",
        },
        "auto_return": "approved",
        "notification_url": SITE_URL + "/pago/confirmacion",
        "statement_descriptor": "MCKENNA GROUP",
        "expires": False,
    }
    try:
        res = requests.post(
            f"{MP_API}/checkout/preferences",
            json=payload,
            headers={
                "Authorization": f"Bearer {MP_ACCESS_TOKEN}",
                "Content-Type": "application/json",
                "X-Idempotency-Key": ref,
            },
            timeout=15,
        )
        if res.status_code in (200, 201):
            data = res.json()
            return {"init_point": data["init_point"], "id": data["id"], "ok": True}
        log.error(f"MP preferencia error {res.status_code}: {res.text[:300]}")
    except Exception as e:
        log.error(f"MP preferencia excepción: {e}")
    return {"ok": False, "init_point": "", "id": ""}


def cart_total(cart: dict) -> float:
    return sum(item["price"] * item["qty"] for item in cart.values())


GUIDES = [
    {
        "title":        "Guía de Ácidos Profesionales",
        "desc":         "Protocolos de uso, concentraciones, mecanismos de acción y peelings para ácido salicílico, hialurónico y glicólico.",
        "url":          "/guias/kit-acidos",
        "category":     "Ácidos y Principios Activos",
        "icon":         "flask",
        "color":        "#143D36",
        "tags":         ["BHA", "AHA", "Peeling", "Skincare"],
        "products":     12,
        "external":     False,
        "sku_prefixes": ["acd", "ktacd", "as-96", "kojic", "alfarb", "dha"],
    },
]


def guide_for_product(sku: str) -> dict | None:
    sl = sku.strip().lower()
    for g in GUIDES:
        for pfx in g.get("sku_prefixes", []):
            if sl.startswith(pfx.lower()):
                return g
    return None


app = Flask(__name__, template_folder="templates", static_folder="static")
app.secret_key = os.getenv("FLASK_SECRET_KEY", "mckg-s3cr3t-2026-!xK9")
app.jinja_env.globals.update(wa_link=wa_link, WA_NUMBER=WA_NUMBER,
                              guide_for_product=guide_for_product)


@app.route("/")
def index():
    catalog   = get_catalog()
    cats      = [s["name"] for s in catalog]
    featured  = []
    for s in catalog:
        featured.extend(s["products"][:2])
        if len(featured) >= 8:
            break
    return render_template("index.html",
        catalog=catalog,
        cats=cats,
        featured=featured[:8])


@app.route("/tienda")
@app.route("/tienda/")
def tienda():
    return redirect(url_for("catalogo"), code=301)


@app.route("/catalogo")
@app.route("/catalogo/")
def catalogo():
    cat_filter = request.args.get("cat", "").strip()
    catalog    = get_catalog()
    if cat_filter:
        sections = [s for s in catalog if s["name"].lower() == cat_filter.lower()]
        if not sections:
            return redirect(url_for("catalogo"))
    else:
        sections = catalog
    cats = [s["name"] for s in catalog]
    return render_template("tienda.html",
        sections=sections,
        cats=cats,
        cat_filter=cat_filter)


@app.route("/producto/<slug>")
def producto(slug):
    p = find_product(slug)
    if not p:
        abort(404)
    catalog = get_catalog()
    # Productos relacionados (misma categoría)
    relacionados = [x for s in catalog if s["name"] == p["cat"]
                    for x in s["products"] if x["ref"] != p["ref"]][:4]
    return render_template("producto.html",
        p=p,
        relacionados=relacionados,
        wa=wa_link(p))


@app.route("/nosotros")
def nosotros():
    return render_template("nosotros.html")


@app.route("/contacto")
def contacto():
    return render_template("contacto.html")


@app.route("/recetario")
def recetario():
    recetas_file = Path(__file__).parent / "data/recetas.json"
    try:
        recetas = json.loads(recetas_file.read_text(encoding="utf-8"))
    except Exception:
        recetas = []
    return render_template("recetario.html", recetas=recetas)


@app.route("/guias")
def guias():
    return render_template("guias.html", guides=GUIDES)


@app.route("/guias/kit-acidos")
def guia_kit_acidos():
    from flask import send_file
    guide = Path(__file__).parent.parent / "guia-kit-acidos.html"
    if guide.exists():
        return send_file(str(guide))
    abort(404)


@app.route("/api/refresh", methods=["POST"])
def api_refresh():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    admin = os.getenv("ADMIN_TOKEN", "")
    if admin and token != admin:
        abort(403)
    data = get_catalog(force=True)
    return jsonify({"ok": True, "categorias": len(data),
                    "productos": sum(len(s["products"]) for s in data)})


# ══════════════════════════════════════════════════════════
#  CARRITO
# ══════════════════════════════════════════════════════════
@app.route("/carrito")
def carrito():
    cart = session.get("cart", {})
    total = cart_total(cart)
    return render_template("carrito.html", cart=cart, total=total)


@app.route("/carrito/agregar", methods=["POST"])
def carrito_agregar():
    slug = request.form.get("slug", "")
    qty  = max(1, int(request.form.get("qty", 1)))
    p = find_product(slug)
    if not p:
        abort(404)
    # Convertir precio a número
    price_str = p["precio"].replace("$", "").replace(".", "").replace(",", "").strip()
    try:
        price = float(price_str)
    except ValueError:
        price = 0.0

    cart = session.get("cart", {})
    if slug in cart:
        cart[slug]["qty"] += qty
    else:
        cart[slug] = {
            "name":  p["name"],
            "ref":   p["ref"],
            "price": price,
            "qty":   qty,
            "photo": p.get("photo", ""),
            "slug":  slug,
        }
    session["cart"] = cart
    session.modified = True

    next_url = request.form.get("next", url_for("carrito"))
    return redirect(next_url)


@app.route("/carrito/actualizar", methods=["POST"])
def carrito_actualizar():
    slug = request.form.get("slug", "")
    qty  = int(request.form.get("qty", 1))
    cart = session.get("cart", {})
    if slug in cart:
        if qty <= 0:
            del cart[slug]
        else:
            cart[slug]["qty"] = qty
    session["cart"] = cart
    session.modified = True
    return redirect(url_for("carrito"))


@app.route("/carrito/eliminar", methods=["POST"])
def carrito_eliminar():
    slug = request.form.get("slug", "")
    cart = session.get("cart", {})
    cart.pop(slug, None)
    session["cart"] = cart
    session.modified = True
    return redirect(url_for("carrito"))


# ══════════════════════════════════════════════════════════
#  CHECKOUT + PAYU
# ══════════════════════════════════════════════════════════
@app.route("/checkout")
def checkout():
    cart = session.get("cart", {})
    if not cart:
        return redirect(url_for("catalogo"))
    total = cart_total(cart)
    ref   = "MCKG-" + uuid.uuid4().hex[:10].upper()
    session["pending_ref"] = ref
    session.modified = True
    return render_template("checkout.html", cart=cart, total=total, ref=ref)


@app.route("/checkout/pagar", methods=["POST"])
def checkout_pagar():
    """Recibe el formulario de datos del comprador, crea preferencia MP y redirige."""
    cart = session.get("cart", {})
    if not cart:
        return redirect(url_for("catalogo"))

    ref           = session.get("pending_ref") or ("MCKG-" + uuid.uuid4().hex[:10].upper())
    subtotal      = cart_total(cart)
    buyer_name    = request.form.get("buyer_name", "").strip()
    buyer_cedula  = request.form.get("buyer_cedula", "").strip()
    buyer_email   = request.form.get("buyer_email", "").strip()
    buyer_phone   = request.form.get("buyer_phone", "").strip()
    buyer_city    = request.form.get("buyer_city", "").strip()
    buyer_dept    = request.form.get("buyer_dept", "").strip()
    buyer_addr    = request.form.get("buyer_address", "").strip()
    buyer_notes   = request.form.get("buyer_notes", "").strip()
    # Facturación
    bill_name     = request.form.get("bill_name", buyer_name).strip() or buyer_name
    bill_nit      = request.form.get("bill_nit", buyer_cedula).strip() or buyer_cedula
    bill_city     = request.form.get("bill_city", buyer_city).strip() or buyer_city
    bill_addr     = request.form.get("bill_address", buyer_addr).strip() or buyer_addr
    bill_email    = request.form.get("bill_email", buyer_email).strip() or buyer_email
    # Envío
    try:
        shipping_cost = float(request.form.get("shipping_cost", 0))
    except ValueError:
        shipping_cost = 0.0
    total = subtotal + shipping_cost

    # Guardar orden en DB como "pending"
    try:
        con = sqlite3.connect(DB_PATH)
        con.execute(
            """INSERT OR IGNORE INTO orders
               (reference, buyer_name, buyer_email, buyer_phone, buyer_city,
                items_json, total, status, created_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (ref, buyer_name, buyer_email, buyer_phone, buyer_city,
             json.dumps({
                 "items": list(cart.values()),
                 "cedula": buyer_cedula,
                 "dept": buyer_dept,
                 "address": buyer_addr,
                 "notes": buyer_notes,
                 "shipping": shipping_cost,
                 "billing": {"name": bill_name, "nit": bill_nit, "city": bill_city,
                              "address": bill_addr, "email": bill_email},
             }, ensure_ascii=False),
             total, "pending", datetime.now().isoformat())
        )
        con.commit()
        con.close()
    except Exception as e:
        log.warning(f"checkout_pagar DB: {e}")

    if not MP_ACCESS_TOKEN:
        # Sin token configurado: mostrar página de confirmación manual
        return render_template("checkout_sin_mp.html",
            ref=ref, total=total,
            buyer_name=buyer_name, buyer_email=buyer_email)

    pref = mp_crear_preferencia(ref, cart, total, shipping_cost)
    if pref["ok"]:
        return redirect(pref["init_point"])

    # Si MP falla, ofrecer pago por WhatsApp como fallback
    return render_template("checkout_sin_mp.html",
        ref=ref, total=total,
        buyer_name=buyer_name, buyer_email=buyer_email)


@app.route("/pago/respuesta")
def pago_respuesta():
    """MercadoPago redirige aquí via back_urls."""
    estado      = request.args.get("estado", "")           # aprobado/rechazado/pendiente
    mp_status   = request.args.get("status", "")           # approved/rejected/pending
    ref         = request.args.get("external_reference", "")
    payment_id  = request.args.get("payment_id", "")
    collection_status = request.args.get("collection_status", "")

    # Normalizar status
    raw = mp_status or collection_status or estado
    if raw in ("approved", "aprobado"):
        status = "approved"
    elif raw in ("rejected", "rechazado"):
        status = "declined"
    else:
        status = "pending"

    if status == "approved":
        session.pop("cart", None)
        session.modified = True
        # Actualizar DB
        try:
            con = sqlite3.connect(DB_PATH)
            con.execute("UPDATE orders SET status='approved', payu_ref=? WHERE reference=?",
                        (payment_id, ref))
            con.commit(); con.close()
        except Exception: pass

    return render_template("pago_respuesta.html",
        status=status, ref=ref, tx_id=payment_id, amount="")


@app.route("/pago/confirmacion", methods=["GET", "POST"])
def pago_confirmacion():
    """Webhook IPN de MercadoPago."""
    topic      = request.args.get("topic") or request.args.get("type", "")
    payment_id = request.args.get("id") or request.args.get("data.id", "")

    if topic not in ("payment", "merchant_order") or not payment_id:
        return "OK", 200

    # Consultar el pago a la API de MP para obtener estado real
    try:
        res = requests.get(
            f"{MP_API}/v1/payments/{payment_id}",
            headers={"Authorization": f"Bearer {MP_ACCESS_TOKEN}"},
            timeout=10,
        )
        if res.status_code == 200:
            data       = res.json()
            ref        = data.get("external_reference", "")
            mp_status  = data.get("status", "")
            mapping    = {"approved": "approved", "rejected": "declined",
                          "in_process": "pending", "pending": "pending"}
            new_status = mapping.get(mp_status, "unknown")
            try:
                con = sqlite3.connect(DB_PATH)
                con.execute("UPDATE orders SET status=?, payu_ref=? WHERE reference=?",
                            (new_status, str(payment_id), ref))
                con.commit(); con.close()
            except Exception as e:
                log.warning(f"MP confirmacion DB: {e}")
            log.info(f"MP IPN: payment={payment_id} ref={ref} status={new_status}")
    except Exception as e:
        log.warning(f"MP IPN consulta: {e}")

    return "OK", 200


@app.route("/mis-pedidos")
def mis_pedidos():
    email = request.args.get("email", "").strip().lower()
    orders = []
    if email:
        try:
            con = sqlite3.connect(DB_PATH)
            con.row_factory = sqlite3.Row
            orders = con.execute(
                "SELECT * FROM orders WHERE lower(buyer_email)=? ORDER BY id DESC LIMIT 20",
                (email,)
            ).fetchall()
            con.close()
        except Exception as e:
            log.warning(f"mis_pedidos: {e}")
    return render_template("mis_pedidos.html", orders=orders, email=email)


@app.route("/api/chat", methods=["POST"])
def api_chat():
    """Proxy público hacia el agente Hugo García (puerto 8081)."""
    data = request.get_json(silent=True) or {}
    message = data.get("message", "").strip()
    if not message:
        return jsonify({"error": "Campo 'message' requerido"}), 400
    try:
        agent_token = os.getenv("CHAT_API_TOKEN", "")
        res = requests.post(
            "http://localhost:8081/chat",
            json={"mensaje": message},
            headers={"Authorization": f"Bearer {agent_token}",
                     "Content-Type": "application/json"},
            timeout=30,
        )
        if res.status_code == 200:
            return jsonify({"reply": res.json().get("respuesta", ""), "ok": True})
        log.warning(f"api_chat upstream {res.status_code}")
    except Exception as e:
        log.warning(f"api_chat: {e}")
    # Fallback: respuesta básica si el agente no está disponible
    return jsonify({
        "reply": ("Hola, soy el asistente de McKenna Group. "
                  "Para asesoría personalizada escríbenos por WhatsApp "
                  f"al +{WA_NUMBER} o llámanos. ¿En qué te podemos ayudar?"),
        "ok": True,
    })


@app.route("/checkout/tarifas")
def checkout_tarifas():
    """Retorna las tarifas de envío para el estimador del checkout."""
    return jsonify(TARIFAS_IR)


@app.route("/checkout/colombia")
def checkout_colombia():
    """Retorna departamentos y municipios de Colombia."""
    return jsonify(COLOMBIA_DATA)


@app.errorhandler(404)
def not_found(e):
    return render_template("404.html"), 404


if __name__ == "__main__":
    init_db()
    log.info("Cargando catálogo inicial...")
    get_catalog()
    log.info("Website McKenna Group iniciando en puerto 8082")
    app.run(host="0.0.0.0", port=8083, debug=False)
