#!/usr/bin/env python3
"""
McKenna Group — Website nativo (Flask)
Fuente de datos: Google Sheets + MeLi API (fotos vía CDN)
Puerto: 8082
"""

import sys, os, json, time, re, logging, sqlite3, uuid, threading
from pathlib import Path
from collections import defaultdict, Counter
from datetime import datetime

ROOT = Path(__file__).resolve().parent.parent.parent   # /home/mckg/mi-agente
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / '.env')

from app.tools.web_pedidos import (
    migrate_orders_table,
    process_order_paid_side_effects,
    get_order_by_reference,
    registrar_envio_y_notificar,
)
from app.services.siigo import listar_productos_combo_siigo, buscar_producto_siigo_por_sku

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
FAMILIAS_FILE = Path(__file__).parent / "data/catalogo_familias.json"
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
#  CATÁLOGO: VITRINA (Sheets agrupada) + COMPRA (combos SIIGO)
# ══════════════════════════════════════════════════════════
_combo_products: list = []
_product_index: dict = {}


def _load_catalogo_familias_config() -> dict:
    try:
        return json.loads(FAMILIAS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _strip_sheet_nombre_noise(raw: str) -> str:
    """Quita texto de inventario, anuncios y basura pegada en la celda NOMBRE del Sheet."""
    if not raw:
        return ""
    n = raw.strip()
    # Inventario / reportes (toda la cola desde la palabra clave)
    n = re.sub(r"(?is)\bINVENTARIO\s+REAL\s+MCKENNA\b.*$", "", n)
    n = re.split(r"(?i)INVENTARIO\s+REAL\s+MCKENNA", n)[0]
    n = re.sub(r"(?is)\bTODO\s+EL\s+STOCK\s+EST[A-Z]*\b.*$", "", n)
    n = re.split(r"(?i)TODO\s+EL\s+STOCK\s+EST", n)[0]
    n = re.split(r"(?i)STOCK\s+EST\s*\(?\s*>\s*\d", n)[0]
    n = re.sub(r"\|\s*\d{1,2}/\d{1,2}/\d{4}[^|]*", "", n)
    # "Catálogo SKU" al inicio o tras coma
    n = re.sub(r"(?i)^\s*catálogo\s+[A-Za-z0-9]{3,}\s*[,;.\-|–:/]+\s*", "", n)
    n = re.sub(r"(?i)\s*[,;]\s*catálogo\s+[A-Za-z0-9]{3,}\s*", ", ", n)
    n = re.sub(r"(?i)\s*[-–]\s*G\s*A\s*\$[^\s]*(\s+[^\s]+)*\s*$", "", n)
    n = re.sub(r"(?i)\s*[-–]\s*G\s*A\s*\$.*$", "", n)
    n = re.sub(r"(?i)\s+\+\s*Env[ií]o\s+.*$", "", n)
    n = re.sub(r"(?i)\s+Env[ií]o\s+(Gratis|Nacional|Nivel\s+Nacional).*$", "", n)
    n = re.sub(r"(?i)\s+Con\s+Fitohomonas.*$", "", n)
    n = re.sub(r"(?i)\s+Gal[oó]n\b.*$", "", n)
    n = re.sub(r"(?i)\s+1\s*Litro\b.*$", "", n)
    n = re.sub(r"(?i)\s+1\s*Kg\b.*$", "", n)
    n = re.sub(r"(?i)\s+Refinada\s+X\s*$", "", n)
    n = re.sub(r"(?i)\s+X\s*$", "", n)
    n = re.sub(r"(?i)\s+Usp\b.*$", "", n)
    n = re.sub(r"(?i)\bUsp\b", "", n)
    n = re.sub(r"(?i)\s+Al\s+85\s*%.*$", "", n)
    n = re.sub(r"(?i)\s+Soluci[oó]n\s+85\s*%.*$", "", n)
    n = re.sub(r"(?i)\s+Todas\s*$", "", n)
    n = re.sub(r"(?i)\s+Pura\s+Anti\s+Grietas.*$", "", n)
    n = re.sub(r"(?i)\s+Org[aá]nica\s+Amarilla.*$", "", n)
    n = re.sub(r"(?i)\s+100%\s*Org[aá]nica.*$", "", n)
    n = re.sub(r"(?i)\s+Blanca\s+X\s*$", "", n)
    n = re.sub(r"(?i)\s+Castor\s+Lt.*$", "", n)
    n = re.sub(r"(?i)\s*\(kit\)\s*$", "", n)
    while True:
        n2 = re.sub(r"\s*\([^)]*\)\s*$", "", n).strip()
        if n2 == n:
            break
        n = n2
    n = re.sub(r"\s+", " ", n).strip(" ,;.|–-")
    return _finalize_catalog_name(n)


def _finalize_catalog_name(n: str) -> str:
    """Último paso: USP suelto, duplicados entre paréntesis, espacios."""
    if not n:
        return n
    x = n.strip()
    x = re.sub(r"(?is)\bINVENTARIO\s+REAL\s+MCKENNA\b.*$", "", x).strip()
    x = re.sub(r"(?i)\s*\(kit\)\s*$", "", x)
    while True:
        x2 = re.sub(r"\s*\([^)]*\)\s*$", "", x).strip()
        if x2 == x:
            break
        x = x2
    x = re.sub(r"(?i)\bUSP\b", "", x)
    x = re.sub(r"\s+", " ", x).strip(" ,;.|–-")
    return x


def _norm_family_key(nombre: str) -> str:
    """Clave de agrupación solo por nombre (fallback si no hay stem SKU)."""
    n = (nombre or "").strip()
    n = re.sub(r"(?i)\s*x\s+catálogo\s*.*$", "", n)
    n = re.sub(r"(?i)\s+catálogo\s+[A-Za-z0-9]{3,}\s*$", "", n)
    n = re.sub(r"(?i)^catálogo\s+[A-Za-z0-9]{3,}\s*$", "", n)
    n = re.sub(r"(?i)\bcatálogo\s+[A-Za-z0-9]{3,}\b", "", n)
    n = re.sub(r"[^\w\sáéíóúüñÁÉÍÓÚÜÑ/]", " ", n)
    n = n.lower()
    for a, b in [
        ("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"), ("ü", "u"), ("ñ", "n"),
    ]:
        n = n.replace(a, b)
    n = re.sub(
        r"\s+todo\s+tipo\s+de\s+piel.*$",
        "",
        n,
        flags=re.I,
    )
    n = re.sub(r"\s+d[ií]a\s*/?\s*noche.*$", "", n, flags=re.I)
    n = re.sub(r"\s+d[ií]a\s+y\s+noche.*$", "", n, flags=re.I)
    n = re.sub(r"\s+\d+\s*g(?:ramos|r)?\b.*$", "", n)
    n = re.sub(r"\s+\d+\s*kg\b.*$", "", n, flags=re.I)
    n = re.sub(r"\s+\d+\s*ml\b.*$", "", n, flags=re.I)
    n = re.sub(r"\s+n/?a\s*$", "", n)
    n = re.sub(r"\s+conservant.*$", "", n, flags=re.I)
    n = re.sub(r"\s+", " ", n).strip()
    # Sinónimos químicos frecuentes (misma vitrina)
    if re.search(r"asc[oó]rb|vitamina\s*c", n):
        if "kojic" in n or "kojico" in n:
            pass
        elif re.search(r"citrat|magnesio", n):
            pass
        else:
            n = "acido ascorbico"
    if re.search(r"k[oó]jic", n):
        n = "acido kojico"
    if re.search(r"hialur[oó]n", n):
        n = "acido hialuronico"
    if re.search(r"acido\s+l[aá]ct", n):
        n = "acido lactico"
    if re.search(r"acido\s+salic", n):
        n = "acido salicilico"
    if re.search(r"acido\s+c[ií]tr[ií]c", n) and "citrato" not in n:
        n = "acido citrico"
    if re.search(r"acido\s+est[eé]ar", n) or re.search(r"acido\s+este", n):
        n = "acido estearico"
    if re.search(r"acido\s+s[oó]rb", n) or ("sorbico" in n and "acido" in n):
        n = "acido sorbico"
    if "citrato" in n and "potasio" in n:
        n = "citrato potasio"
    if "cloruro" in n and "magnesio" in n:
        n = "cloruro magnesio"
    if (
        "citrato" in n
        and "magnesio" in n
        and "cloruro" not in n
        and not ("potasio" in n and "calcio" in n)
    ):
        n = "citrato magnesio sal"
    if "bisglic" in n and "magnesio" in n:
        n = "bisglicinato magnesio"
    if "alcohol" in n and "cetil" in n:
        n = "alcohol cetilico"
    if "lanette" in n:
        n = "cera lanette"
    if ("tensioactivo" in n and "sci" in n) or (
        "sci" in n.split() and "tensio" in n
    ):
        n = "tensioactivo sci"
    if "cocoyl" in n and "isethion" in n:
        n = "tensioactivo sci"
    if "urea" in n and ("cosmet" in n or "cosm" in n):
        n = "urea cosmetica"
    if "inulina" in n or "inulin" in n:
        n = "inulina"
    if "sharomix" in n:
        n = "sharomix"
    if "alulosa" in n:
        n = "alulosa"
    if "eritrit" in n:
        n = "eritritol"
    if "fructosa" in n:
        n = "fructosa"
    if "arbutina" in n or "alfa arbut" in n:
        n = "alfa arbutina"
    if "sulfato" in n and "cobre" in n:
        n = "sulfato cobre"
    if "suero" in n and "leche" in n:
        n = "suero leche"
    if "alginato" in n and "sodio" in n:
        n = "alginato sodio"
    if "glicerina" in n or "glicerol" in n:
        n = "glicerina vegetal"
    if "jabon" in n and "potas" in n:
        n = "jabon potasico"
    # Español "xantana" / inglés "xanthan"; misma línea aunque el SKU difiera (GMXTN vs GMXNT).
    if ("goma" in n and ("xant" in n or "xanthan" in n)) or re.search(
        r"\bxantana\b", n
    ):
        n = "goma xantana"
    elif "goma" in n and "guar" in n:
        n = "goma guar"
    if "almidon" in n and "yuca" in n:
        n = "almidon yuca"
    if "capsula" in n and ("gelatina" in n or "vac" in n):
        n = "capsulas gelatina"
    if "dextrosa" in n:
        n = "dextrosa"
    if "glutamato" in n and "monosod" in n:
        n = "glutamato monosodico"
    if "colageno" in n and ("hidroliz" in n or "cosmet" in n):
        n = "colageno hidrolizado cosmetico"
    if "vaselina" in n:
        n = "vaselina"
    if "lanolina" in n:
        n = "lanolina"
    if "cera" in n and "carna" in n:
        n = "cera carnauba"
    if "cera" in n and "abeja" in n:
        n = "cera abeja amarilla"
    if "manteca" in n and "karit" in n:
        n = "manteca karite"
    if "aceite" in n and "neem" in n:
        n = "aceite neem"
    if "aceite" in n and ("ricino" in n or "castor" in n):
        n = "aceite ricino"
    if "aceite" in n and "girasol" in n:
        n = "aceite girasol"
    if "aceite" in n and "linaza" in n:
        n = "aceite linaza"
    return n


def _kit_stem_from_nombre(nombre_clean: str) -> str | None:
    """Combos / kits de compra rápida (siempre categoría Kits)."""
    nl = (nombre_clean or "").lower()
    if "alginato" in nl and "cloruro" in nl and "calcio" in nl:
        return "KIT_ALGINATO_CLORURO_CA"
    if "alginato" in nl and "lactato" in nl and "calcio" in nl:
        return "KIT_ALGINATO_LACTATO_CA"
    if "citrato" in nl and "magnesio" in nl and "potasio" in nl and "calcio" in nl:
        return "KIT_CITRATO_MG_PK_CA"
    return None


def _name_derived_stem(nombre_clean: str) -> str | None:
    """Stem solo por nombre cuando el SKU no es suficientemente específico."""
    fk = _norm_family_key(nombre_clean)
    if not fk:
        return None
    m = {
        "jabon potasico": "JABONPOTASICO",
        "goma xantana": "GOMAXANTANA",
        "almidon yuca": "ALMIDONYUCA",
        "capsulas gelatina": "CAPSULASGEL",
        "dextrosa": "DEXTROSA",
        "glutamato monosodico": "GLUTAMONO",
        "colageno hidrolizado cosmetico": "COLAGENOHI",
        "vaselina": "VASELINA",
        "lanolina": "LANOLINA",
        "cera carnauba": "CERACARNAUBA",
        "cera abeja amarilla": "CERAABEJA",
        "manteca karite": "MANTECAKARITE",
        "aceite neem": "NEEM",
        "aceite ricino": "RICINO",
        "acido hialuronico": "HIALURONICO",
        "acido lactico": "ACDLACTICO",
        "acido salicilico": "ACDSALICILICO",
        "acido sorbico": "ACDSORBICO",
        "citrato potasio": "CITRATOPOTASIO",
        "cloruro magnesio": "CLORUROMAGNESIO",
        "acido citrico": "ACIDCITRICO",
        "acido estearico": "ACIDESTEARICO",
        "aceite girasol": "GIRASOL",
        "aceite linaza": "LINAZA",
        "citrato magnesio sal": "CITRATOMAGSAL",
        "bisglicinato magnesio": "BISGLICINATOMG",
        "alcohol cetilico": "ALCOHOLCETILICO",
        "cera lanette": "CERALANETTE",
        "tensioactivo sci": "TENSIOSCI",
        "urea cosmetica": "UREACOSMETICA",
        "goma guar": "GOMAGUAR",
        "inulina": "INULINA",
        "sharomix": "SHAROMIX",
        "alulosa": "ALULOSA",
        "eritritol": "ERITRITOL",
        "fructosa": "FRUCTOSA",
        "alfa arbutina": "ALFAARBUTINA",
        "sulfato cobre": "SULFATOCOBRE",
        "suero leche": "SUEROLECHE",
        "alginato sodio": "ALGINATOSODIO",
        "glicerina vegetal": "GLICERINAVEGETAL",
    }
    return m.get(fk)


def _sku_family_stem(sku: str) -> str | None:
    """
    Prefijo lógico de línea de producto para agrupar variantes (peso, envase, etc.).
    Orden: excepciones ACDASC / citrato; prefijos largos primero; reglas genéricas al final.
    """
    u = (sku or "").strip().upper()
    if len(u) < 4:
        return None
    if u.startswith("ACDASCTMG"):
        return re.sub(r"\d.*$", "", u) or "ACDASCTMG"
    if u.startswith("ACDASCT"):
        return re.sub(r"\d.*$", "", u) or u[:12]
    if u.startswith("ACDASC"):
        return "ACDASC"
    if u.startswith("ACDKJC"):
        return "ACDKJC"
    # Vitamina C / ácido ascórbico cosmético (líquidos, etc.)
    if u.startswith("VTMC"):
        return "ACDASC"

    _pairs = sorted(
        [
            ("KTACDHIA", "HIALURONICO"),
            ("CRABJRFBLKG", "MANTECAKARITE"),
            ("ACDHLR", "HIALURONICO"),
            ("ACDHIA", "HIALURONICO"),
            ("MTNKRT", "MANTECAKARITE"),
            ("CRABJR", "CERAABEJA"),
            ("GLC", "GLICERINAVEGETAL"),
            ("ALCCTL", "ALCOHOLCETILICO"),
            ("CRLNT", "CERALANETTE"),
            ("TSCI", "TENSIOSCI"),
            ("URCS", "UREACOSMETICA"),
            ("CTMG", "CITRATOMAGSAL"),
            ("GMXTN", "GOMAXANTANA"),
            ("GMXNT", "GOMAXANTANA"),
            ("OLTK", "JABONPOTASICO"),
            ("BCAA", "BCAAAMINO"),
            ("ALGNA", "ALGINATOSODIO"),
            ("GMGR", "GOMAGUAR"),
            ("FRBSGL", "BISGLICINATOMG"),
            ("SALKMG", "BISGLICINATOMG"),
            ("SLFCUL", "SULFATOCOBRE"),
            ("SRLCH", "SUEROLECHE"),
            ("INL", "INULINA"),
            ("SHRMX", "SHAROMIX"),
            ("SHRX", "SHAROMIX"),
            ("ALLS", "ALULOSA"),
            ("ERTT", "ERITRITOL"),
            ("FRCT", "FRUCTOSA"),
            ("ALFARB", "ALFAARBUTINA"),
            ("MNTCCRFKG", "MANTECACACAO"),
            ("OILESN", "NEEM"),
            ("OILNEM", "NEEM"),
            ("OILNM", "NEEM"),
            ("OILGRS", "GIRASOL"),
            ("OILLN", "LINAZA"),
            ("OILRIC", "RICINO"),
            ("OILRCN", "RICINO"),
            ("OILRC", "RICINO"),
            ("OILCAS", "RICINO"),
            ("CRCRN", "CERACARNAUBA"),
            ("BCARNA", "CERAABEJA"),
            ("LNLN", "LANOLINA"),
            ("MNTCC", "MANTECACACAO"),
            ("MNTKL", "MANTECAKARITE"),
            ("MNTK", "MANTECAKARITE"),
            ("VSL", "VASELINA"),
            ("ACDLACT", "ACDLACTICO"),
            ("ACDLAC", "ACDLACTICO"),
            ("ACDSALI", "ACDSALICILICO"),
            ("ACDSL", "ACDSALICILICO"),
            ("ACDCTR", "ACIDCITRICO"),
            ("ACDEST", "ACIDESTEARICO"),
            ("ACDMLC", "ACIDMALICO"),
            ("SRBT", "ACDSORBICO"),
            ("SRBK", "ACDSORBICO"),
            ("CLRMG", "CLORUROMAGNESIO"),
            ("CTRZN", "CITRATOPOTASIO"),
            ("HYAL", "HIALURONICO"),
            ("CLGNHD", "COLAGENOHI"),
            ("CLGN", "COLAGENOHI"),
            ("DXDT", "DEXTROSA"),
            ("DXT", "DEXTROSA"),
            ("GLTSSNBR", "GLUTAMONO"),
            ("GMSN", "GOMAXANTANA"),
            ("ALMYU", "ALMIDONYUCA"),
        ],
        key=lambda x: -len(x[0]),
    )
    for prefix, stem in _pairs:
        if u.startswith(prefix):
            return stem

    base = re.sub(r"\d.*$", "", u)
    return base if len(base) >= 4 else None


def _family_stem(sku: str, nombre_clean: str) -> str | None:
    ks = _kit_stem_from_nombre(nombre_clean)
    if ks:
        return ks
    ss = _sku_family_stem(sku)
    if ss:
        return ss
    return _name_derived_stem(nombre_clean)


def _majority_stem(items: list) -> str | None:
    """Si varias filas comparten nombre normalizado, elige el stem más frecuente (prefs MeLi / slug)."""
    stems = [x.get("_stem") for x in items if x.get("_stem")]
    if not stems:
        return None
    return Counter(stems).most_common(1)[0][0]


def _catalog_group_token(line: dict) -> str:
    """
    Una sola ficha de vitrina por nombre de producto (normalizado), aunque los SKU difieran.
    Los kits se siguen agrupando por stem. Si el nombre no da clave estable, se usa stem/SKU.
    """
    stem = line.get("_stem")
    if stem and stem.startswith("KIT_"):
        return f"sku:{stem}"
    nk = _norm_family_key(line["nombre"])
    if nk and len(nk.strip()) >= 4:
        return f"namegrp:{nk}"
    if stem:
        return f"sku:{stem}"
    fk = nk or (line.get("sku") or "").lower()
    return f"name:{fk}" if fk else f"sku:{line.get('sku', '').lower()}"


def _effective_catalog_category(base_cat: str, stem: str | None) -> str:
    if stem and stem.startswith("KIT_"):
        return "Kits"
    if stem == "HIALURONICO":
        return "Kits"
    return base_cat


_CANONICAL_FAMILY_TITLE = {
    "ACDASC": "Ácido ascórbico",
    "ACDKJC": "Ácido kójico",
    "ACDASCTMG": "Citrato de magnesio y vitamina C",
    "ACIDESTEARICO": "Ácido esteárico",
    "GIRASOL": "Aceite de girasol",
    "LINAZA": "Aceite de linaza",
    "HIALURONICO": "Ácido hialurónico",
    "NEEM": "Aceite de neem",
    "RICINO": "Aceite de ricino",
    "CERACARNAUBA": "Cera carnaúba",
    "CERAABEJA": "Cera de abejas amarilla",
    "LANOLINA": "Lanolina",
    "MANTECAKARITE": "Manteca de karité",
    "MANTECACACAO": "Manteca de cacao",
    "VASELINA": "Vaselina",
    "ACDLACTICO": "Ácido láctico",
    "ACDSALICILICO": "Ácido salicílico",
    "ACDSORBICO": "Ácido sórbico",
    "ACIDCITRICO": "Ácido cítrico",
    "ACIDMALICO": "Ácido málico",
    "CLORUROMAGNESIO": "Cloruro de magnesio",
    "CITRATOPOTASIO": "Citrato de potasio",
    "COLAGENOHI": "Colágeno hidrolizado cosmético",
    "DEXTROSA": "Dextrosa",
    "GLUTAMONO": "Glutamato monosódico",
    "GOMAXANTANA": "Goma xantana",
    "CAPSULASGEL": "Cápsulas gelatina",
    "ALMIDONYUCA": "Almidón de yuca",
    "JABONPOTASICO": "Jabón potásico",
    "ALCOHOLCETILICO": "Alcohol cetílico",
    "CERALANETTE": "Cera Lanette N",
    "TENSIOSCI": "Tensioactivo SCI",
    "UREACOSMETICA": "Urea cosmética",
    "CITRATOMAGSAL": "Citrato de magnesio",
    "BISGLICINATOMG": "Bisglicinato de magnesio",
    "SULFATOCOBRE": "Sulfato de cobre",
    "SUEROLECHE": "Suero de leche",
    "BCAAAMINO": "BCAA (aminoácidos)",
    "ALGINATOSODIO": "Alginato de sodio",
    "GOMAGUAR": "Goma guar",
    "INULINA": "Inulina",
    "SHAROMIX": "Sharomix 705",
    "ALULOSA": "Alulosa",
    "ERITRITOL": "Eritritol",
    "FRUCTOSA": "Fructosa",
    "ALFAARBUTINA": "Alfa arbutina",
    "KIT_ALGINATO_CLORURO_CA": "Kit alginato y cloruro de calcio",
    "KIT_ALGINATO_LACTATO_CA": "Kit alginato y lactato de calcio",
    "KIT_CITRATO_MG_PK_CA": "Kit citrato magnesio, potasio y calcio",
    "GLICERINAVEGETAL": "Glicerina vegetal",
}


def _canonical_family_slug(stem: str) -> str | None:
    m = {
        "ACDASC": "acido-ascorbico",
        "ACDKJC": "acido-kojico",
        "ACDASCTMG": "citrato-magnesio-vitamina-c",
        "HIALURONICO": "acido-hialuronico",
        "NEEM": "aceite-neem",
        "RICINO": "aceite-ricino",
        "CERACARNAUBA": "cera-carnauba",
        "CERAABEJA": "cera-abejas-amarilla",
        "LANOLINA": "lanolina",
        "MANTECAKARITE": "manteca-karite",
        "MANTECACACAO": "manteca-cacao",
        "VASELINA": "vaselina",
        "ACDLACTICO": "acido-lactico",
        "ACDSALICILICO": "acido-salicilico",
        "ACDSORBICO": "acido-sorbico",
        "ACIDCITRICO": "acido-citrico",
        "ACIDESTEARICO": "acido-estearico",
        "GIRASOL": "aceite-girasol",
        "LINAZA": "aceite-linaza",
        "ACIDMALICO": "acido-malico",
        "CLORUROMAGNESIO": "cloruro-magnesio",
        "CITRATOPOTASIO": "citrato-potasio",
        "COLAGENOHI": "colageno-hidrolizado",
        "DEXTROSA": "dextrosa",
        "GLUTAMONO": "glutamato-monosodico",
        "GOMAXANTANA": "goma-xantana",
        "CAPSULASGEL": "capsulas-gelatina",
        "ALMIDONYUCA": "almidon-yuca",
        "JABONPOTASICO": "jabon-potasio",
        "ALCOHOLCETILICO": "alcohol-cetilico",
        "CERALANETTE": "cera-lanette",
        "TENSIOSCI": "tensioactivo-sci",
        "UREACOSMETICA": "urea-cosmetica",
        "CITRATOMAGSAL": "citrato-magnesio",
        "BISGLICINATOMG": "bisglicinato-magnesio",
        "SULFATOCOBRE": "sulfato-cobre",
        "SUEROLECHE": "suero-leche",
        "BCAAAMINO": "bcaa-aminoacidos",
        "ALGINATOSODIO": "alginato-sodio",
        "GOMAGUAR": "goma-guar",
        "INULINA": "inulina",
        "SHAROMIX": "sharomix-705",
        "ALULOSA": "alulosa",
        "ERITRITOL": "eritritol",
        "FRUCTOSA": "fructosa",
        "ALFAARBUTINA": "alfa-arbutina",
        "KIT_ALGINATO_CLORURO_CA": "kit-alginato-cloruro-calcio",
        "KIT_ALGINATO_LACTATO_CA": "kit-alginato-lactato-calcio",
        "KIT_CITRATO_MG_PK_CA": "kit-citrato-mg-pk-ca",
        "GLICERINAVEGETAL": "glicerina-vegetal",
    }
    return m.get(stem)


_PREFERRED_REP_SKU = {
    "CERACARNAUBA": "CRCRN250G",
    "HIALURONICO": "ACDHIA85P30ML",
    "MANTECAKARITE": "MTNKRTKG",
    "CERAABEJA": "CRABJRFKG",
    "ALCOHOLCETILICO": "ALCCTLLB",
    "CERALANETTE": "CRLNT250G",
    "TENSIOSCI": "TSCI100G",
    "UREACOSMETICA": "URCSM250G",
    "GLICERINAVEGETAL": "GLC500ML",
    "GOMAXANTANA": "GMXTNLB",
    "JABONPOTASICO": "OLTKLT",
    "BCAAAMINO": "BCAALB",
    "SHAROMIX": "SHRMX500ML",
    "ALULOSA": "ALLSKG",
}

# No usar como tarjeta principal si hay otra referencia en la familia.
_DEPRIORITIZE_REP_SKU = frozenset(
    {
        "GMXTNKG",
        "OLTKGL",
        "BCAA250G",
        "ALLSLB",
        "SHRX250ML",
        "CRABJRFLB",
        "MNTKKG",
        "CRABJRFBLKG",
        "ALCCTLKG",
        "CRLNTLB",
        "TSCILB",
        "GLC250ML",
        "URCSMLB",
    }
)

# Prefijos SKU: misma lógica (p. ej. otra presentación de hialurónico).
_DEPRIORITIZE_REP_PREFIXES = ("ACDHLR",)


def _display_family_name(nombre: str, sku_stem: str | None = None) -> str:
    if sku_stem and sku_stem in _CANONICAL_FAMILY_TITLE:
        return _CANONICAL_FAMILY_TITLE[sku_stem]
    n = (nombre or "").strip()
    n = re.sub(r"(?i)\s*x\s+catálogo\s*.*$", "", n)
    n = re.sub(r"(?i)\s+catálogo\s+[A-Za-z0-9]{3,}\s*$", "", n)
    n = re.sub(r"(?i)^catálogo\s+[A-Za-z0-9]{3,}\s*$", "", n)
    n = re.sub(r"(?i)\bcatálogo\s+[A-Za-z0-9]{3,}\b", "", n)
    n = re.sub(r"\s+\d+\s*g(?:ramos|r)?\b.*$", "", n, flags=re.I)
    n = re.sub(r"\s+\d+\s*ml\b.*$", "", n, flags=re.I)
    n = re.sub(r"\s+N/?A\s*$", "", n, flags=re.I)
    n = re.sub(r"\s+Conservant.*$", "", n, flags=re.I)
    n = re.sub(
        r"\s+Todo\s+Tipo\s+De\s+Piel.*$",
        "",
        n,
        flags=re.I,
    )
    n = re.sub(r"\s+D[ií]a/noche.*$", "", n, flags=re.I)
    n = re.sub(r"\s+", " ", n).strip()
    if not n:
        return (nombre or "").strip()
    # Tildes típicas en química cosmética
    fixes = [
        (r"(?i)\bacido\s+ascorbico\b", "Ácido ascórbico"),
        (r"(?i)\bacido\s+kojico\b", "Ácido kójico"),
        (r"(?i)\bvitamina\s+c\b", "Vitamina C"),
    ]
    for pat, rep in fixes:
        if re.search(pat, n):
            n = re.sub(pat, rep, n, count=1)
            break
    nk = _norm_family_key(n)
    _tit = {
        "acido ascorbico": "Ácido ascórbico",
        "acido kojico": "Ácido kójico",
        "acido hialuronico": "Ácido hialurónico",
        "acido lactico": "Ácido láctico",
        "acido salicilico": "Ácido salicílico",
        "acido sorbico": "Ácido sórbico",
        "citrato potasio": "Citrato de potasio",
        "cloruro magnesio": "Cloruro de magnesio",
        "goma xantana": "Goma xantana",
        "almidon yuca": "Almidón de yuca",
        "dextrosa": "Dextrosa",
        "glutamato monosodico": "Glutamato monosódico",
        "capsulas gelatina": "Cápsulas de gelatina",
        "colageno hidrolizado cosmetico": "Colágeno hidrolizado cosmético",
        "jabon potasico": "Jabón potásico",
        "vaselina": "Vaselina",
        "lanolina": "Lanolina",
        "cera carnauba": "Cera carnaúba",
        "cera abeja amarilla": "Cera de abejas amarilla",
        "manteca karite": "Manteca de karité",
        "aceite neem": "Aceite de neem",
        "aceite ricino": "Aceite de ricino",
        "aceite girasol": "Aceite de girasol",
        "aceite linaza": "Aceite de linaza",
        "acido citrico": "Ácido cítrico",
        "acido estearico": "Ácido esteárico",
        "citrato magnesio sal": "Citrato de magnesio",
        "bisglicinato magnesio": "Bisglicinato de magnesio",
        "alcohol cetilico": "Alcohol cetílico",
        "cera lanette": "Cera Lanette N",
        "tensioactivo sci": "Tensioactivo SCI",
        "urea cosmetica": "Urea cosmética",
        "goma guar": "Goma guar",
        "inulina": "Inulina",
        "sharomix": "Sharomix 705",
        "alulosa": "Alulosa",
        "eritritol": "Eritritol",
        "fructosa": "Fructosa",
        "alfa arbutina": "Alfa arbutina",
        "sulfato cobre": "Sulfato de cobre",
        "suero leche": "Suero de leche",
        "alginato sodio": "Alginato de sodio",
        "glicerina vegetal": "Glicerina vegetal",
    }
    if nk in _tit:
        return _tit[nk]
    return _finalize_catalog_name(n.strip())


def _slug_from_key(key: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", key.lower()).strip("-")
    return (s[:96] or "producto").strip("-")


def _fmt_precio(n: float) -> str:
    return f"${n:,.0f}".replace(",", ".")


def _parse_precio_sheet(raw: str) -> float | None:
    if not raw or not str(raw).strip():
        return None
    t = str(raw).strip().replace("$", "").replace(" ", "")
    t = t.replace(",", "")
    try:
        v = float(t)
        return v if v > 0 else None
    except ValueError:
        return None


def _sheet_row_to_line(
    sku: str,
    nombre: str,
    meli_id: str,
    desc_raw: str,
    precio_meli: float | None,
    cat: str,
    nombre_original: str | None = None,
) -> dict:
    if precio_meli and precio_meli > 0:
        precio_desc = precio_meli * (1 - MELI_COMMISSION)
        ahorro = precio_meli * MELI_COMMISSION
        precio = _fmt_precio(precio_desc)
        precio_meli_s = _fmt_precio(precio_meli)
        ahorro_s = _fmt_precio(ahorro)
    else:
        precio = "—"
        precio_meli_s = "—"
        ahorro_s = "—"
    return {
        "name": _finalize_catalog_name(nombre),
        "ref": sku,
        "slug": re.sub(r"[^a-z0-9\-]", "-", sku.lower()),
        "precio": precio,
        "precio_meli": precio_meli_s,
        "ahorro": ahorro_s,
        "photo": None,
        "meli_id": meli_id if meli_id.startswith("MCO") else "",
        "cat": cat,
        "cat_color": CAT_COLORS.get(cat, "#2E8B7A"),
        "desc": desc_raw[:450] if desc_raw else "",
        "ficha": buscar_ficha(nombre_original or nombre) or buscar_ficha(nombre),
        "solo_referencia": True,
        "buyable": False,
    }


def _combo_dict_desde_siigo_raw(raw: dict) -> dict | None:
    code = (raw.get("code") or "").strip()
    if not code:
        return None
    nombre = (raw.get("name") or "").strip() or code
    try:
        lista = float(raw["prices"][0]["price_list"][0]["value"])
    except (KeyError, IndexError, TypeError, ValueError):
        lista = 0.0
    precio_web = lista * (1 - MELI_COMMISSION) if lista > 0 else 0.0
    ahorro = lista * MELI_COMMISSION if lista > 0 else 0.0
    slug = _slug_from_key(code.lower())
    return {
        "name": nombre,
        "ref": code,
        "slug": slug,
        "precio": _fmt_precio(precio_web) if precio_web > 0 else "—",
        "precio_meli": _fmt_precio(lista) if lista > 0 else "—",
        "precio_num": round(precio_web, 2),
        "lista_num": round(lista, 2),
        "ahorro": _fmt_precio(ahorro) if ahorro > 0 else "—",
        "photo": "",
        "meli_id": "",
        "cat": "Combos",
        "cat_color": CAT_COLORS.get("Kits", "#2E8B7A"),
        "desc": (raw.get("description") or "")[:450],
        "ficha": None,
        "buyable": True,
        "is_combo": True,
        "precio_canal_label": "Lista",
    }


def leer_catalogo() -> tuple[list, list]:
    """Sheets → familias (vitrina); SIIGO → combos (comprables). Retorna (secciones, combos_planos)."""
    log.info("Conectando con Google Sheets (vitrina)…")
    gc = gspread.service_account(filename=CREDS_PATH)
    wb = gc.open_by_key(SHEET_ID)
    ws = wb.sheet1
    rows = ws.get_all_values()
    log.info(f"  {len(rows)-1} filas en Sheets")

    header = [h.strip().upper() for h in rows[0]]
    idx_meli = 0
    idx_sku = next((i for i, h in enumerate(header) if "SKU" in h), 1)
    idx_nombre = next((i for i, h in enumerate(header) if "NOMBRE" in h), 3)
    idx_precio = next((i for i, h in enumerate(header) if "PRECIO" in h), 4)
    idx_desc = next((i for i, h in enumerate(header) if any(k in h for k in ["FICHA", "TDS", "DESC", "TECNICA", "TÉCNICA"])), 8)

    seen_sku = set()
    id_to_sku = {}
    raw_lines = []

    for row in rows[1:]:
        if len(row) <= max(idx_sku, idx_nombre):
            continue
        meli_id = str(row[idx_meli]).strip().upper() if row[idx_meli] else ""
        sku = row[idx_sku].strip()
        nombre_original = row[idx_nombre].strip()
        nombre = _strip_sheet_nombre_noise(nombre_original) or nombre_original
        precio_raw = row[idx_precio].strip() if len(row) > idx_precio else ""
        desc_raw = row[idx_desc].strip() if len(row) > idx_desc else ""
        if not sku or not nombre or sku in seen_sku:
            continue
        seen_sku.add(sku)
        if meli_id.startswith("MCO"):
            id_to_sku[meli_id] = sku
        pm = _parse_precio_sheet(precio_raw)
        base_cat = categorize(sku)
        stem = _family_stem(sku, nombre)
        eff_cat = _effective_catalog_category(base_cat, stem)
        raw_lines.append(
            {
                "sku": sku,
                "nombre": nombre,
                "nombre_original": nombre_original,
                "meli_id": meli_id,
                "desc_raw": desc_raw,
                "precio_meli": pm,
                "cat": eff_cat,
                "_stem": stem,
            }
        )

    token = get_meli_token()
    photo_map = fetch_meli_photo_urls(token, id_to_sku)
    for line in raw_lines:
        line["photo"] = photo_map.get(line["sku"], "")

    cfg = _load_catalogo_familias_config()
    slug_to_combo_skus = cfg.get("slug_to_combo_skus") or cfg.get("slug_to_combos") or {}
    photo_pref_by_stem = dict(_PREFERRED_REP_SKU)
    photo_pref_by_stem.update(cfg.get("preferred_photo_by_stem", {}))

    extra_codes = [c.strip() for c in os.getenv("WEB_SIIGO_COMBO_CODES", "").split(",") if c.strip()]
    log.info("Consultando combos en SIIGO…")
    combos_raw = listar_productos_combo_siigo()
    combos_by_code = {}
    for raw in combos_raw:
        d = _combo_dict_desde_siigo_raw(raw)
        if d:
            combos_by_code[d["ref"].upper()] = d
    for code in extra_codes:
        cu = code.upper()
        if cu in combos_by_code:
            continue
        info = buscar_producto_siigo_por_sku(code)
        if not info:
            continue
        faux = {
            "code": info.get("referencia") or code,
            "name": info.get("nombre") or code,
            "description": "",
            "prices": [{"price_list": [{"value": float(info.get("precio") or 0)}]}],
            "active": True,
            "type": "Combo",
        }
        d = _combo_dict_desde_siigo_raw(faux)
        if d:
            combos_by_code[d["ref"].upper()] = d

    combo_flat = list(combos_by_code.values())
    assigned_codes = set()
    for codes in slug_to_combo_skus.values():
        for c in codes:
            assigned_codes.add(str(c).strip().upper())

    groups: dict[str, list] = defaultdict(list)
    for line in raw_lines:
        groups[_catalog_group_token(line)].append(line)

    def pick_representative(items: list, stem_hint: str | None) -> dict:
        pref = photo_pref_by_stem.get(stem_hint or "")
        if pref:
            pu = pref.strip().upper()
            for x in items:
                if x["sku"].upper() == pu:
                    return x
            for x in items:
                if pu in x["sku"].upper():
                    return x

        def _rep_score(x: dict) -> tuple:
            nm = (x.get("nombre") or "").lower()
            usp = 1 if "usp" in nm else 0
            meli = 0 if x.get("meli_id", "").startswith("MCO") else 1
            sku_u = x.get("sku", "").strip().upper()
            dep = 1 if sku_u in _DEPRIORITIZE_REP_SKU else 0
            if not dep and any(sku_u.startswith(p) for p in _DEPRIORITIZE_REP_PREFIXES):
                dep = 1
            return (usp, meli, dep, len(x.get("nombre") or ""))

        with_meli = [x for x in items if x.get("meli_id", "").startswith("MCO")]
        pool = with_meli or items
        return min(pool, key=_rep_score)

    families_by_cat: dict[str, list] = defaultdict(list)
    used_slugs: set[str] = set()

    for gtoken, items in groups.items():
        if gtoken.startswith("sku:"):
            stem_hint = gtoken[4:]
        else:
            stem_hint = _majority_stem(items)
        rep = pick_representative(items, stem_hint)
        stem = stem_hint
        if stem and stem in _CANONICAL_FAMILY_TITLE:
            base_slug = _canonical_family_slug(stem) or _slug_from_key(stem.lower())
            display_name = _display_family_name(rep["nombre"], stem)
        elif gtoken.startswith("namegrp:"):
            nk_body = gtoken[8:]
            base_slug = _slug_from_key(nk_body)
            display_name = _display_family_name(rep["nombre"], stem)
        elif gtoken.startswith("name:"):
            fk_body = gtoken[5:]
            base_slug = _slug_from_key(fk_body)
            display_name = _display_family_name(rep["nombre"], stem)
        else:
            base_slug = _slug_from_key((stem or rep["sku"]).lower())
            display_name = _display_family_name(rep["nombre"], stem)

        slug = base_slug
        n = 0
        while slug in used_slugs:
            n += 1
            slug = f"{base_slug}-{n}"
        used_slugs.add(slug)
        sorted_items = sorted(items, key=lambda z: z["nombre"].lower())
        line_objs = []
        for x in sorted_items:
            lo = _sheet_row_to_line(
                x["sku"],
                x["nombre"],
                x["meli_id"],
                x["desc_raw"],
                x["precio_meli"],
                x["cat"],
                nombre_original=x.get("nombre_original") or x["nombre"],
            )
            lo["photo"] = x.get("photo") or ""
            line_objs.append(lo)

        combo_codes = slug_to_combo_skus.get(slug) or slug_to_combo_skus.get(base_slug) or []
        fam_combos = []
        for code in combo_codes:
            c = combos_by_code.get(str(code).strip().upper())
            if c:
                fam_combos.append(c)
                c["family_slug"] = slug

        nums_web = []
        for c in fam_combos:
            if c.get("precio_num"):
                nums_web.append(c["precio_num"])
        for x in items:
            pm = x.get("precio_meli")
            if pm and pm > 0:
                nums_web.append(pm * (1 - MELI_COMMISSION))

        if nums_web:
            mn = min(nums_web)
            mx = max(nums_web)
            rango = _fmt_precio(mn) if abs(mn - mx) < 0.01 else f"Desde {_fmt_precio(mn)}"
        else:
            rango = "Consultar"

        precio_meli_ref = line_objs[0]["precio_meli"] if line_objs else "—"

        rep_cat = rep["cat"]
        family = {
            "name": display_name,
            "ref": rep["sku"],
            "rep_sku": rep["sku"],
            "slug": slug,
            "precio": rango,
            "precio_meli": precio_meli_ref,
            "ahorro": "—",
            "photo": rep.get("photo") or "",
            "meli_id": rep["meli_id"] if rep["meli_id"].startswith("MCO") else "",
            "cat": rep_cat,
            "cat_color": CAT_COLORS.get(rep_cat, "#2E8B7A"),
            "desc": (rep["desc_raw"][:450] if rep.get("desc_raw") else "")
            or (line_objs[0].get("desc", "") if line_objs else ""),
            "ficha": buscar_ficha(rep.get("nombre_original") or rep["nombre"])
            or buscar_ficha(rep["nombre"])
            or buscar_ficha(display_name),
            "solo_vitrina": True,
            "buyable": False,
            "referencias": line_objs,
            "combos": fam_combos,
            "precio_canal_label": "Referencia",
        }
        families_by_cat[rep_cat].append(family)

    for c in combo_flat:
        cu = c["ref"].upper()
        if cu in assigned_codes:
            continue
        fam_slug = _slug_from_key(c["name"] + "-" + c["ref"])
        base_fs = fam_slug
        n = 0
        while fam_slug in used_slugs:
            n += 1
            fam_slug = f"{base_fs}-{n}"
        used_slugs.add(fam_slug)
        c["family_slug"] = fam_slug
        solo = {
            "name": c["name"],
            "ref": c["ref"],
            "rep_sku": c["ref"],
            "slug": fam_slug,
            "precio": c["precio"],
            "precio_meli": c["precio_meli"],
            "ahorro": c["ahorro"],
            "photo": "",
            "meli_id": "",
            "cat": "Combos",
            "cat_color": CAT_COLORS.get("Kits", "#2E8B7A"),
            "desc": c.get("desc", ""),
            "ficha": None,
            "solo_vitrina": True,
            "buyable": False,
            "referencias": [],
            "combos": [c],
            "precio_canal_label": c.get("precio_canal_label", "Lista"),
        }
        families_by_cat["Combos"].append(solo)
        assigned_codes.add(cu)

    orden = [cat for _, cat in CATEGORY_MAP] + ["Otros", "Combos"]
    seen_ord, orden_final = set(), []
    for c in orden:
        if c not in seen_ord:
            seen_ord.add(c)
            orden_final.append(c)

    result = []
    for cat in orden_final:
        if cat in families_by_cat and families_by_cat[cat]:
            prods = sorted(families_by_cat[cat], key=lambda p: p["name"].lower())
            result.append({"name": cat, "products": prods})
    for cat, prods in families_by_cat.items():
        if cat not in seen_ord and prods:
            result.append({"name": cat, "products": sorted(prods, key=lambda p: p["name"].lower())})

    total_f = sum(len(s["products"]) for s in result)
    log.info(f"Catálogo listo: {len(result)} categorías, {total_f} familias, {len(combo_flat)} combos SIIGO")
    return result, combo_flat


# ══════════════════════════════════════════════════════════
#  CACHE
# ══════════════════════════════════════════════════════════
_catalog_cache = {"data": None, "ts": 0}


def _rebuild_product_index(data: list, combo_flat: list) -> None:
    global _combo_products, _product_index
    _combo_products = combo_flat
    _product_index = {}
    for s in data:
        for p in s["products"]:
            _product_index[p["slug"].lower()] = p
    for c in combo_flat:
        _product_index[c["slug"].lower()] = c


def get_catalog(force=False) -> list:
    global _catalog_cache
    now = time.time()
    if not force and _catalog_cache["data"] and (now - _catalog_cache["ts"]) < CACHE_TTL:
        return _catalog_cache["data"]

    if not force and CACHE_FILE.exists():
        age = now - CACHE_FILE.stat().st_mtime
        if age < CACHE_TTL:
            try:
                raw = json.loads(CACHE_FILE.read_text())
                if isinstance(raw, dict) and "sections" in raw:
                    data = raw["sections"]
                    combos = raw.get("combos", [])
                else:
                    data = raw
                    combos = []
                _rebuild_product_index(data, combos)
                _catalog_cache.update({"data": data, "ts": now})
                log.info(f"Catálogo cargado desde cache ({int(age/60)} min)")
                return data
            except Exception:
                pass

    try:
        data, combo_flat = leer_catalogo()
        _rebuild_product_index(data, combo_flat)
        _catalog_cache.update({"data": data, "ts": now})
        CACHE_FILE.parent.mkdir(exist_ok=True)
        payload = {"sections": data, "combos": combo_flat, "version": 2}
        CACHE_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
        log.info("Cache guardado en disco")
        return data
    except Exception as e:
        log.error(f"Error construyendo catálogo: {e}")
        if _catalog_cache["data"]:
            return _catalog_cache["data"]
        if CACHE_FILE.exists():
            try:
                raw = json.loads(CACHE_FILE.read_text())
                if isinstance(raw, dict) and "sections" in raw:
                    _rebuild_product_index(raw["sections"], raw.get("combos", []))
                    return raw["sections"]
                if isinstance(raw, list):
                    _rebuild_product_index(raw, [])
                    return raw
            except Exception:
                pass
        return []


def get_all_products(catalog=None) -> list:
    if catalog is None:
        catalog = get_catalog()
    return [p for section in catalog for p in section["products"]]


def find_product(slug_or_sku: str) -> dict | None:
    if not slug_or_sku:
        return None
    sl = slug_or_sku.strip().lower()
    p = _product_index.get(sl)
    if p:
        return p
    for c in _combo_products:
        if c["ref"].lower() == sl:
            return c
    for x in get_all_products():
        if x["ref"].lower() == sl:
            return x
    return None


def wa_link(producto: dict) -> str:
    if producto.get("combos"):
        c0 = producto["combos"][0]
        msg = (
            f"Hola, quiero ordenar: *{c0['name']}* "
            f"(Ref: {c0['ref']}) — {c0['precio']} COP"
        )
    elif producto.get("is_combo"):
        msg = (
            f"Hola, quiero ordenar: *{producto['name']}* "
            f"(Ref: {producto['ref']}) — {producto['precio']} COP"
        )
    else:
        msg = (
            f"Hola, me interesa: *{producto['name']}* "
            f"(catálogo). Ref. histórica: {producto.get('ref', '')}"
        )
    return f"https://wa.me/{WA_NUMBER}?text={requests.utils.quote(msg)}"


# ══════════════════════════════════════════════════════════
#  FLASK APP
# ══════════════════════════════════════════════════════════
def init_db():
    """Crea/migra la tabla orders (compartida con app.tools.web_pedidos)."""
    DB_PATH.parent.mkdir(exist_ok=True)
    migrate_orders_table()

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


_GUIAS_JSON = Path(__file__).parent / "data/guias.json"

def _load_guias_dinamicas() -> list:
    try:
        if _GUIAS_JSON.exists():
            data = json.loads(_GUIAS_JSON.read_text(encoding="utf-8"))
            return [
                {
                    "title":    g["title_short"],
                    "desc":     g["desc"],
                    "url":      f"/guias/{g['slug']}",
                    "category": g["category"],
                    "icon":     g.get("icon", "flask"),
                    "color":    g.get("color", "#143D36"),
                    "tags":     g.get("tags", []),
                    "products": g.get("products", 1),
                    "external": False,
                    "sku_prefixes": [],
                }
                for g in data if g.get("publicada", True)
            ]
    except Exception:
        pass
    return []

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
] + _load_guias_dinamicas()


def guide_for_product(sku: str) -> dict | None:
    sl = sku.strip().lower()
    for g in GUIDES:
        for pfx in g.get("sku_prefixes", []):
            if sl.startswith(pfx.lower()):
                return g
    return None


app = Flask(__name__, template_folder="templates", static_folder="static")
app.secret_key = os.getenv("FLASK_SECRET_KEY", "mckg-s3cr3t-2026-!xK9")
META_PIXEL_ID = os.getenv("META_PIXEL_ID", "")
app.jinja_env.globals.update(
    wa_link=wa_link,
    WA_NUMBER=WA_NUMBER,
    guide_for_product=guide_for_product,
    META_PIXEL_ID=META_PIXEL_ID,
    SITE_URL=SITE_URL,
)


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
    cat_name = p.get("cat") or ""
    my_slug = p.get("slug", "")
    relacionados = [
        x for s in catalog if s["name"] == cat_name
        for x in s["products"]
        if x.get("slug") != my_slug
    ][:4]
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


@app.route("/sitemap.xml")
def sitemap():
    from flask import Response
    from datetime import date
    today = date.today().isoformat()
    data_dir = Path(__file__).parent / "data"
    try:
        guias = json.loads((data_dir / "guias.json").read_text(encoding="utf-8"))
    except Exception:
        guias = []
    try:
        posts = [p for p in json.loads((data_dir / "posts.json").read_text(encoding="utf-8")) if p.get("publicado")]
    except Exception:
        posts = []
    try:
        cache = json.loads((data_dir / "cache.json").read_text(encoding="utf-8"))
        if isinstance(cache, dict) and "sections" in cache:
            sections = cache["sections"]
            cats = [c["name"] for c in sections]
            prod_slugs = [p["slug"] for s in sections for p in s.get("products", []) if p.get("slug")]
            combo_slugs = [c["slug"] for c in cache.get("combos", []) if c.get("slug")]
        else:
            sections = cache if isinstance(cache, list) else []
            cats = [c["name"] for c in sections]
            prod_slugs = [p["slug"] for s in sections for p in s.get("products", []) if p.get("slug")]
            combo_slugs = []
    except Exception:
        cats, prod_slugs, combo_slugs = [], [], []

    urls = []
    static_pages = [
        ("", "1.0", "daily"),
        ("/catalogo", "0.9", "daily"),
        ("/guias", "0.9", "weekly"),
        ("/recetario", "0.8", "weekly"),
        ("/blog", "0.9", "daily"),
        ("/nosotros", "0.6", "monthly"),
        ("/contacto", "0.6", "monthly"),
    ]
    for path, pri, freq in static_pages:
        urls.append(f'<url><loc>{SITE_URL}{path}</loc><lastmod>{today}</lastmod><changefreq>{freq}</changefreq><priority>{pri}</priority></url>')
    for cat in cats:
        urls.append(f'<url><loc>{SITE_URL}/catalogo?cat={requests.utils.quote(cat)}</loc><lastmod>{today}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>')
    for g in guias:
        if g.get("publicada", True):
            fecha = g.get("fecha", today)
            urls.append(f'<url><loc>{SITE_URL}/guias/{g["slug"]}</loc><lastmod>{fecha}</lastmod><changefreq>monthly</changefreq><priority>0.75</priority></url>')
    for p in posts:
        fecha = p.get("fecha", today)
        urls.append(f'<url><loc>{SITE_URL}/blog/{p["slug"]}</loc><lastmod>{fecha}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>')
    for slug in sorted(set(prod_slugs + combo_slugs)):
        urls.append(
            f"<url><loc>{SITE_URL}/producto/{slug}</loc>"
            f"<lastmod>{today}</lastmod><changefreq>weekly</changefreq><priority>0.75</priority></url>"
        )

    xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    xml += "\n".join(urls)
    xml += "\n</urlset>"
    return Response(xml, mimetype="application/xml")


@app.route("/robots.txt")
def robots():
    from flask import Response
    txt = (
        f"User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /pedido/\n"
        f"Sitemap: {SITE_URL}/sitemap.xml\n"
    )
    return Response(txt, mimetype="text/plain")


@app.route("/facebook-catalog.xml")
def facebook_catalog():
    from flask import Response
    data_dir = Path(__file__).parent / "data"
    try:
        raw = json.loads((data_dir / "cache.json").read_text(encoding="utf-8"))
        if isinstance(raw, dict) and "combos" in raw:
            combos_fb = raw["combos"]
        else:
            combos_fb = []
    except Exception:
        combos_fb = []

    items = []
    for p in combos_fb:
        if not p.get("buyable") or not p.get("is_combo"):
            continue
        sku = p.get("ref", "")
        name = p.get("name", "")
        precio_n = p.get("precio_num")
        if not sku or not name or not precio_n:
            continue
        foto = p.get("photo") or ""
        desc = p.get("desc", name)
        link = f"{SITE_URL}/producto/{p.get('slug', sku)}"
        price_str = f"{int(round(precio_n))}.00 COP"
        items.append(f"""  <item>
    <id>{sku}</id>
    <title><![CDATA[{name}]]></title>
    <description><![CDATA[{desc[:200]}]]></description>
    <availability>in stock</availability>
    <condition>new</condition>
    <price>{price_str}</price>
    <link>{link}</link>
    <image_link>{foto}</image_link>
    <brand>McKenna Group S.A.S.</brand>
    <google_product_category>Health &amp; Beauty</google_product_category>
  </item>""")

    xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    xml += '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n<channel>\n'
    xml += f'<title>McKenna Group — Catálogo</title>\n<link>{SITE_URL}</link>\n'
    xml += "\n".join(items)
    xml += "\n</channel>\n</rss>"
    return Response(xml, mimetype="application/xml")


@app.route("/descargo-de-responsabilidad")
def descargo():
    return render_template("descargo.html")


@app.route("/politica-de-datos")
def politica_datos():
    return render_template("tratamiento_datos.html")


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


@app.route("/guias/<slug>")
def guia_detalle(slug):
    try:
        data = json.loads(_GUIAS_JSON.read_text(encoding="utf-8"))
        guia = next((g for g in data if g["slug"] == slug and g.get("publicada", True)), None)
    except Exception:
        guia = None
    if not guia:
        abort(404)
    return render_template("guia_detalle.html", g=guia, WA_NUMBER=WA_NUMBER)


@app.route("/blog")
@app.route("/blog/")
def blog():
    posts_file = Path(__file__).parent / "data/posts.json"
    try:
        posts = json.loads(posts_file.read_text(encoding="utf-8"))
        posts = [p for p in posts if p.get("publicado", True)]
        posts.sort(key=lambda p: p.get("fecha", ""), reverse=True)
    except Exception:
        posts = []
    return render_template("blog.html", posts=posts)


@app.route("/blog/<slug>")
def blog_post(slug):
    posts_file = Path(__file__).parent / "data/posts.json"
    try:
        posts = json.loads(posts_file.read_text(encoding="utf-8"))
        post = next((p for p in posts if p.get("slug") == slug and p.get("publicado", True)), None)
    except Exception:
        post = None
    if not post:
        abort(404)
    return render_template("blog_post.html", post=post)


@app.route("/api/refresh", methods=["POST"])
def api_refresh():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    admin = os.getenv("ADMIN_TOKEN", "")
    if admin and token != admin:
        abort(403)
    data = get_catalog(force=True)
    return jsonify({
        "ok": True,
        "categorias": len(data),
        "familias_catalogo": sum(len(s["products"]) for s in data),
        "combos_siigo": len(_combo_products),
    })


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
    if not p.get("buyable"):
        log.warning("Carrito: SKU no comprable (solo vitrina): %s", slug)
        return redirect(url_for("catalogo"))

    price = float(p.get("precio_num") or 0)
    if price <= 0:
        price_str = p.get("precio", "").replace("$", "").replace(".", "").replace(",", "").strip()
        try:
            price = float(price_str)
        except ValueError:
            price = 0.0

    cart_key = p.get("slug", slug).strip().lower()
    cart = session.get("cart", {})
    if cart_key in cart:
        cart[cart_key]["qty"] += qty
    else:
        cart[cart_key] = {
            "name":  p["name"],
            "ref":   p["ref"],
            "price": price,
            "qty":   qty,
            "photo": p.get("photo", ""),
            "slug":  cart_key,
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
    init_db()
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
    init_db()
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
        track_tok = str(uuid.uuid4())
        con.execute(
            """INSERT OR IGNORE INTO orders
               (reference, buyer_name, buyer_email, buyer_phone, buyer_city,
                items_json, total, status, created_at, tracking_token)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
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
             total, "pending", datetime.now().isoformat(), track_tok)
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


def _resolver_referencia_mp(external_ref: str, payment_id: str) -> str:
    ref = (external_ref or "").strip().upper()
    if ref:
        return ref
    if not payment_id or not MP_ACCESS_TOKEN:
        return ""
    try:
        res = requests.get(
            f"{MP_API}/v1/payments/{payment_id}",
            headers={"Authorization": f"Bearer {MP_ACCESS_TOKEN}"},
            timeout=10,
        )
        if res.status_code == 200:
            return (res.json().get("external_reference") or "").strip().upper()
    except Exception as e:
        log.warning(f"resolver ref MP: {e}")
    return ""


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
        init_db()
        session.pop("cart", None)
        session.modified = True
        ref = _resolver_referencia_mp(ref, payment_id)
        if ref:
            try:
                con = sqlite3.connect(DB_PATH)
                con.execute(
                    "UPDATE orders SET status='approved', payu_ref=? WHERE upper(reference)=?",
                    (payment_id, ref),
                )
                con.commit()
                con.close()
            except Exception:
                pass
            threading.Thread(
                target=process_order_paid_side_effects,
                args=(ref,),
                daemon=True,
            ).start()

    return render_template("pago_respuesta.html",
        status=status, ref=ref, tx_id=payment_id, amount="")


@app.route("/pago/confirmacion", methods=["GET", "POST"])
def pago_confirmacion():
    """Webhook IPN de MercadoPago."""
    init_db()
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
                rup = ref.strip().upper() if ref else ""
                con.execute(
                    "UPDATE orders SET status=?, payu_ref=? WHERE upper(reference)=?",
                    (new_status, str(payment_id), rup),
                )
                con.commit()
                con.close()
            except Exception as e:
                log.warning(f"MP confirmacion DB: {e}")
            log.info(f"MP IPN: payment={payment_id} ref={ref} status={new_status}")
            if new_status == "approved" and ref:
                threading.Thread(
                    target=process_order_paid_side_effects,
                    args=(ref.strip().upper(),),
                    daemon=True,
                ).start()
    except Exception as e:
        log.warning(f"MP IPN consulta: {e}")

    return "OK", 200


@app.route("/mis-pedidos")
def mis_pedidos():
    init_db()
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


@app.route("/pedido/seguimiento/<ref>")
def pedido_seguimiento(ref: str):
    """Estado de envío con enlace secreto (token) enviado por correo."""
    token = request.args.get("t", "").strip()
    init_db()
    order = get_order_by_reference(ref)
    if not order or not order.get("tracking_token") or order["tracking_token"] != token:
        abort(404)
    return render_template("pedido_seguimiento.html", order=order, SITE_URL=SITE_URL)


@app.route("/api/pedido/envio", methods=["POST"])
def api_pedido_envio():
    """Registra guía y envía correo «en camino» al cliente. Bearer ADMIN_TOKEN."""
    auth = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
    if not auth or auth != os.getenv("ADMIN_TOKEN", ""):
        abort(403)
    body = request.get_json(silent=True) or {}
    reference = (body.get("reference") or body.get("ref") or "").strip()
    guia = (body.get("tracking_number") or body.get("guia") or "").strip()
    carrier = (body.get("carrier") or body.get("transportadora") or "").strip()
    ok, msg = registrar_envio_y_notificar(reference, guia, carrier)
    return jsonify({"ok": ok, "message": msg})


@app.route("/api/chat", methods=["POST"])
def api_chat():
    """Proxy público hacia el agente Hugo García (puerto 8081)."""
    data = request.get_json(silent=True) or {}
    message = data.get("message", "").strip()
    if not message:
        return jsonify({"error": "Campo 'message' requerido"}), 400
    session_id = (data.get("session_id") or data.get("sessionId") or "").strip()
    if not session_id:
        session_id = session.get("hugo_chat_session")
        if not session_id:
            session_id = str(uuid.uuid4())
            session["hugo_chat_session"] = session_id
            session.modified = True
    try:
        agent_token = os.getenv("CHAT_API_TOKEN", "")
        res = requests.post(
            "http://localhost:8081/chat",
            json={"mensaje": message, "session_id": session_id},
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
