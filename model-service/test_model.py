from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch

model = AutoModelForSequenceClassification.from_pretrained("./model")
tokenizer = AutoTokenizer.from_pretrained("./model")
model.eval()

T = 1.8  # calibrated temperature

def score(text):
    inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=256)
    with torch.no_grad():
        logits = model(**inputs).logits[0]
    probs = torch.softmax(logits / T, dim=-1).numpy()
    print(f"AI: {probs[1]:.2%}  Human: {probs[0]:.2%}")

score("""WAR WITH IRAN Iranian ‘top target’ hit in $10M precision strike; US kamikaze drones used to 'overwhelm' Cameron Chell says Operation Epic Fury likely paired expensive precision assets against leadership compound with cheaper suicide drones By Emma Bussey Fox News Published February 28, 2026 7:16pm EST Facebook Twitter Threads Flipboard Comments Print Email Add Fox News on Google IDF shares video of missile strikes on Iranian launchers Video released by the Israel Defense Forces showed what appear to be successful strikes on Iranian missile launchers Saturday. (IDF) Israel struck its key target in Tehran Saturday in what a defense expert has described as a multimillion-dollar precision-guided attack alongside a broader offensive involving U.S. waves of lower-cost kamikaze drones. Cameron Chell, CEO of drone manufacturer Draganfly, told Fox News Digital the campaign would have likely paired advanced and costly assets against Supreme Leader Ayatollah Ali Khamenei’s compound, while U.S. forces used cheaper drones to "overwhelm" on land, air and sea. U.S. Central Command (CENTCOM) also confirmed that the drones were deployed for the first time in history. "CENTCOM's Task Force Scorpion Strike — for the first time in history — is using one-way attack drones in combat during Operation Epic Fury," it said in an X post before adding that the "low-cost drones, modeled after Iran's Shahed drones, are now delivering American-made retribution." "Saturday saw an overwhelming daytime attack with incredible intelligence to target the leadership and a strike on the compound possibly costing tens of millions," Chell said. "That would likely have included expensive, precision-strike drones or manned aircraft in highly coordinated attacks to ensure success, not necessarily the lower-cost, one-way version of the suicide drones, he explained. The U.S. has this lower-cost alternative to hit everything at once, but then the very expensive, high-precision assets would likely have gone directly after leadership on Saturday, Chell added. A map of Western strikes against Iran (Fox News) A senior U.S. official confirmed to Fox News that the compound strike was a wildly bold daytime attack. It caught the senior leadership off guard on a Saturday morning during Ramadan and on Shabbat in the daytime, the official added. We hit the senior leaders right out of the gate, the source told Fox national security correspondent Jennifer Griffin. Iran’s military, government and intelligen""")
