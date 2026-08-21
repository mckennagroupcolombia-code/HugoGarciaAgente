"""Departamentos/municipios de Colombia (DIVIPOLA, nombres) para el checkout
web y para la sección "¿A dónde hemos llegado?" del inicio (cobertura real).

Fuente única de `COLOMBIA_DATA`: antes vivía duplicado solo en website.py (usado
por el selector departamento/ciudad del checkout). Aquí se reutiliza además
para clasificar `buyer_city` (pedidos web) y las ciudades reales de envío MeLi
(ver app/tools/cobertura_meli.py) en departamento + municipio.
"""

from __future__ import annotations

import unicodedata

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

TOTAL_DEPARTAMENTOS = len(COLOMBIA_DATA)
TOTAL_MUNICIPIOS = sum(len(v) for v in COLOMBIA_DATA.values())


def _normalizar(texto: str) -> str:
    """minúsculas, sin tildes/diéresis, espacios colapsados — para comparar nombres."""
    if not texto:
        return ""
    sin_tildes = "".join(
        c for c in unicodedata.normalize("NFKD", texto) if not unicodedata.combining(c)
    )
    return " ".join(sin_tildes.lower().split())


_MUNICIPIO_A_DEPTO: dict[str, tuple[str, str]] = {}
_DEPTO_NORM: dict[str, str] = {}
for _depto, _municipios in COLOMBIA_DATA.items():
    _DEPTO_NORM[_normalizar(_depto)] = _depto
    for _m in _municipios:
        _MUNICIPIO_A_DEPTO.setdefault(_normalizar(_m), (_depto, _m))

# Alias frecuentes en direcciones de envío que no calzan literal con DIVIPOLA.
_ALIAS_MUNICIPIO = {
    "bogota": ("Bogotá D.C.", "Bogotá D.C."),
    "bogota dc": ("Bogotá D.C.", "Bogotá D.C."),
    "bogota d c": ("Bogotá D.C.", "Bogotá D.C."),
    "cartagena de indias": ("Bolívar", "Cartagena"),
    "medellin": ("Antioquia", "Medellín"),
}


def resolver_departamento_municipio(ciudad: str) -> tuple[str, str] | None:
    """(departamento, municipio) para una ciudad en texto libre, o None si no calza
    con ningún municipio conocido (direcciones mal escritas, veredas, etc.)."""
    key = _normalizar(ciudad)
    if not key:
        return None
    if key in _MUNICIPIO_A_DEPTO:
        return _MUNICIPIO_A_DEPTO[key]
    if key in _ALIAS_MUNICIPIO:
        return _ALIAS_MUNICIPIO[key]
    return None


def resolver_departamento(nombre: str) -> str | None:
    """Nombre oficial del departamento a partir de texto libre (para el `state.name`
    que ya entrega MeLi directamente, sin necesitar pasar por municipio)."""
    return _DEPTO_NORM.get(_normalizar(nombre))
